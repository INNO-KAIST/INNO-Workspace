// Public documentation is candidate evidence only. It is never an account model catalog.
const SOURCES = Object.freeze([
  {provider:'openai',url:'https://developers.openai.com/api/docs/models.md',parse:parseOpenAI},
  {provider:'claude',url:'https://code.claude.com/docs/en/model-config.md',parse:parseClaude},
]);
const DAY=86400000, LEASE=60000, MAX_BYTES=200000, MAX_CANDIDATES=128, TIMEOUT=8000;
const idPattern=/^[a-z][a-z0-9._-]{1,79}$/;
const key=provider=>`official_model_discovery_${provider}`;

function parseOpenAI(markdown){
  if(!/^# Models\s*$/m.test(markdown))throw Error('format_changed');
  // The catalog Markdown lists explicit links to model documentation pages.
  const section=markdown.match(/^## Browse our full catalog of models\s*$([\s\S]*?)(?=^## |$(?![\s\S]))/m)?.[1];
  if(!section)throw Error('format_changed');
  const ids=[];
  for(const line of section.split(/\r?\n/)){
    const match=line.match(/^- \[[^\]]+\]\(\/api\/docs\/models\/([a-z0-9._-]+)\.md\):\s+.+$/);
    if(match)ids.push(match[1]);
  }
  if(!ids.length||ids.length>MAX_CANDIDATES||new Set(ids).size!==ids.length)throw Error('format_changed');
  return ids.map(id=>({id,documentedTarget:null,kind:'documentation_slug'}));
}

function parseClaude(markdown){
  if(!/^# Model configuration\s*$/m.test(markdown))throw Error('format_changed');
  const section=markdown.match(/^#{2,3} Model aliases\s*$([\s\S]*?)(?=^#{2,3} |$(?![\s\S]))/m)?.[1];
  if(!section||!/^\|\s*Model alias\s*\|\s*Behavior\s*\|/mi.test(section))throw Error('format_changed');
  const aliases=[];
  for(const line of section.split(/\r?\n/)){
    const match=line.match(/^\|\s*(?:\*\*)?`([a-z][a-z0-9-]{1,39})`(?:\*\*)?\s*\|\s*[^|]+\|\s*$/);
    if(match&&!['default','best','opusplan'].includes(match[1]))aliases.push(match[1]);
  }
  if(!aliases.length||aliases.length>20||new Set(aliases).size!==aliases.length)throw Error('format_changed');
  const providerRow=section.match(/^\|\s*Anthropic API\s*\|\s*(?:Claude )?(Opus [0-9]+(?:\.[0-9]+)?)\s*\|\s*(?:Claude )?(Sonnet [0-9]+(?:\.[0-9]+)?)\s*\|/mi);
  if(!providerRow)throw Error('format_changed');
  return aliases.map(id=>({id,documentedTarget:id==='opus'?providerRow[1]:id==='sonnet'?providerRow[2]:null,kind:'alias'}));
}

function parseStored(value){try{const result=JSON.parse(value);return result&&typeof result==='object'&&Array.isArray(result.candidates)?result:null;}catch{return null;}}
function publicCandidate(source,candidate){return {provider:source.provider,id:candidate.id,kind:candidate.kind,documentedTarget:candidate.documentedTarget,sourceUrl:source.url,evidenceType:'official_documentation',channel:source.provider==='openai'?'api_documentation':'claude_code_documentation',accountAvailability:'unknown',promotionStatus:'candidate'};}
function failureCode(error){return ['format_changed','redirect_rejected','body_too_large','http_error','content_type_changed','timeout'].includes(error?.message)?error.message:'network_error';}
function backoff(failures){return Math.min(DAY,900000*2**Math.min(failures-1,7));}

async function boundedGet(fetchFn,source,previous,timeoutMs){
  const controller=new AbortController();let timer;
  const headers={};if(previous?.etag)headers['if-none-match']=previous.etag;if(previous?.lastModified)headers['if-modified-since']=previous.lastModified;
  try{
    const deadline=new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(Error('timeout'));},timeoutMs);});
    const response=await Promise.race([
      fetchFn(source.url,{method:'GET',headers,credentials:'omit',redirect:'manual',signal:controller.signal}),
      deadline,
    ]);
    if(response.url&&response.url!==source.url)throw Error('redirect_rejected');
    if(response.status>=300&&response.status<400&&response.status!==304)throw Error('redirect_rejected');
    if(response.status===304)return {notModified:true};
    if(response.status!==200)throw Error('http_error');
    if(!/^(text\/markdown|text\/plain)(?:;|$)/i.test(response.headers.get('content-type')??''))throw Error('content_type_changed');
    const declared=Number(response.headers.get('content-length'));if(Number.isFinite(declared)&&declared>MAX_BYTES)throw Error('body_too_large');
    let size=0;const chunks=[];const reader=response.body?.getReader();if(!reader)throw Error('format_changed');
    for(;;){const {done,value}=await Promise.race([reader.read(),deadline]);if(done)break;size+=value.byteLength;if(size>MAX_BYTES){void reader.cancel().catch(()=>{});throw Error('body_too_large');}chunks.push(value);}
    const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
    let markdown;try{markdown=new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{throw Error('format_changed');}
    const candidates=source.parse(markdown);
    if(candidates.some(c=>!idPattern.test(c.id)))throw Error('format_changed');
    return {candidates,etag:(response.headers.get('etag')??'').slice(0,200),lastModified:(response.headers.get('last-modified')??'').slice(0,100)};
  }finally{clearTimeout(timer);controller.abort();}
}

export class OfficialModelDiscovery{
  constructor(store,{fetchFn=fetch,timeoutMs=TIMEOUT}={}){this.store=store;this.fetchFn=fetchFn;this.timeoutMs=timeoutMs;}
  async stored(source){const row=await this.store.db.prepare('SELECT value FROM metadata WHERE key=?1').bind(key(source.provider)).first();return row?parseStored(row.value):null;}
  async persist(source,record,lock){
    const result=await this.store.db.prepare("INSERT INTO metadata(key,value) SELECT ?1,?2 WHERE (SELECT value FROM metadata WHERE key='official_model_discovery_lock')=?3 ON CONFLICT(key) DO UPDATE SET value=excluded.value WHERE (SELECT value FROM metadata WHERE key='official_model_discovery_lock')=?3").bind(key(source.provider),JSON.stringify(record),lock).run();
    return result.meta.changes>0;
  }
  async read(){
    const now=Date.parse(this.store.now()),sources=[],candidates=[];
    for(const source of SOURCES){
      const record=await this.stored(source),expired=record?.verifiedAt==null||now-record.verifiedAt>=DAY*2;
      sources.push({provider:source.provider,url:source.url,status:!record?'unavailable':record.lastError||expired?'stale':'fresh',verifiedAt:record?.verifiedAt??null,expiresAt:record?.verifiedAt==null?null:record.verifiedAt+DAY*2,nextAttemptAt:record?.nextAttemptAt??null,lastError:record?.lastError??null});
      for(const candidate of record?.candidates??[])candidates.push(publicCandidate(source,candidate));
    }
    return {sources,candidates};
  }
  async refresh(){
    const now=Date.parse(this.store.now()),owner=crypto.randomUUID(),lock=JSON.stringify({owner,expiresAt:now+LEASE});
    const claim=await this.store.db.prepare("INSERT INTO metadata(key,value) VALUES('official_model_discovery_lock',?1) ON CONFLICT(key) DO UPDATE SET value=excluded.value WHERE CAST(json_extract(metadata.value,'$.expiresAt') AS INTEGER)<=?2").bind(lock,now).run();
    if(!claim.meta.changes)return {claimed:false};
    try{
      for(const source of SOURCES){
        const previous=await this.stored(source);if(previous?.nextAttemptAt>now)continue;
        try{
          const fetched=await boundedGet(this.fetchFn,source,previous,this.timeoutMs);
          if(fetched.notModified&&!previous?.candidates?.length)throw Error('format_changed');
          const record={candidates:fetched.notModified?previous.candidates:fetched.candidates,verifiedAt:now,nextAttemptAt:now+DAY,consecutiveFailures:0,lastError:null,etag:fetched.notModified?previous.etag:fetched.etag,lastModified:fetched.notModified?previous.lastModified:fetched.lastModified};
          if(!await this.persist(source,record,lock))return {claimed:false};
        }catch(error){
          const failures=(previous?.consecutiveFailures??0)+1;
          const record={candidates:previous?.candidates??[],verifiedAt:previous?.verifiedAt??null,nextAttemptAt:now+backoff(failures),consecutiveFailures:failures,lastError:failureCode(error),etag:previous?.etag??'',lastModified:previous?.lastModified??''};
          if(!await this.persist(source,record,lock))return {claimed:false};
        }
      }
      return {claimed:true};
    }finally{await this.store.db.prepare("DELETE FROM metadata WHERE key='official_model_discovery_lock' AND value=?1").bind(lock).run();}
  }
}
