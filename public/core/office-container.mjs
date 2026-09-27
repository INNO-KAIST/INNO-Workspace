// Bounded container validation only: not XML semantics, rendering, or content quality.
const parts={
 'application/vnd.openxmlformats-officedocument.wordprocessingml.document':'word/document.xml',
 'application/vnd.openxmlformats-officedocument.presentationml.presentation':'ppt/presentation.xml',
 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':'xl/workbook.xml',
};
const fail=()=>{throw Object.assign(new Error('Invalid Office ZIP container or required package parts'),{name:'ValidationError',statusCode:400});};
export function validateOfficeContainer(mime,bytes){
 const main=parts[mime];if(!main)return;
 if(!(bytes instanceof Uint8Array)||bytes.length<22||bytes.length>10000000)fail();
 const data=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
 const u16=p=>data.getUint16(p,true),u32=p=>data.getUint32(p,true);
 let end=-1;for(let p=bytes.length-22;p>=Math.max(0,bytes.length-65557);p--)if(u32(p)===0x06054b50&&p+22+u16(p+20)===bytes.length){end=p;break;}
 if(end<0||u16(end+4)!==0||u16(end+6)!==0||u16(end+8)!==u16(end+10))fail();
 const count=u16(end+10),size=u32(end+12),start=u32(end+16);
 if(!count||count>10000||start+size!==end)fail();
 const decoder=new TextDecoder('utf-8',{fatal:true}),names=new Set();let cursor=start,total=0;
 for(let i=0;i<count;i++){
  if(cursor+46>end||u32(cursor)!==0x02014b50)fail();
  const flags=u16(cursor+8),method=u16(cursor+10),packed=u32(cursor+20),unpacked=u32(cursor+24),nameLength=u16(cursor+28),extra=u16(cursor+30),comment=u16(cursor+32),local=u32(cursor+42);
  const next=cursor+46+nameLength+extra+comment;
  if(!nameLength||next>end||(flags&1)||![0,8].includes(method)||u16(cursor+34)!==0||local+30>start)fail();
  let name;try{name=decoder.decode(bytes.subarray(cursor+46,cursor+46+nameLength));}catch{fail();}
  if(names.has(name)||name.startsWith('/')||name.includes('\\')||name.split('/').includes('..'))fail();names.add(name);
  if(u32(local)!==0x04034b50||u16(local+6)!==flags||u16(local+8)!==method||u16(local+26)!==nameLength)fail();
  const contentStart=local+30+nameLength+u16(local+28);
  if(contentStart+packed>start)fail();
  for(let n=0;n<nameLength;n++)if(bytes[local+30+n]!==bytes[cursor+46+n])fail();
  if(!(flags&8)&&(u32(local+18)!==packed||u32(local+22)!==unpacked||u32(local+14)!==u32(cursor+16)))fail();
  total+=unpacked;if(total>100000000||unpacked===0xffffffff||packed===0xffffffff)fail();
  cursor=next;
 }
 if(cursor!==end||!['[Content_Types].xml','_rels/.rels',main].every(p=>names.has(p)))fail();
}
export function validateOfficeArtifact(artifact){
 if(!parts[artifact.mime])return;
 if(artifact.encoding!=='base64'||typeof artifact.content!=='string')fail();
 let raw;try{raw=atob(artifact.content);}catch{fail();}
 validateOfficeContainer(artifact.mime,Uint8Array.from(raw,c=>c.charCodeAt(0)));
}
