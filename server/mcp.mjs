import {readTaskContext} from '../public/core/task-context-read.mjs';
const CONTEXT_DIGEST={type:'string',pattern:'^[0-9a-f]{64}$'};
const RESUME_STATE={description:'Optional derived resume state, at most 32768 UTF-8 bytes. Omit to preserve; null clears. source_matched verifies source hashes only, never semantic completeness, quality or approval authority. Allowed only on a running checkpoint, not completed.',anyOf:[{type:'null'},{type:'object',required:['version','taskId','mode','basis','items'],additionalProperties:false,properties:{
  version:{const:1},taskId:{type:'string',pattern:'^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$'},mode:{enum:['root','child','review']},
  basis:{type:'object',required:['requestDigest','historyDigest','scopeDigest','messageCount'],additionalProperties:false,properties:{requestDigest:CONTEXT_DIGEST,historyDigest:CONTEXT_DIGEST,scopeDigest:CONTEXT_DIGEST,messageCount:{type:'integer',minimum:0,maximum:Number.MAX_SAFE_INTEGER}}},
  items:{type:'array',minItems:1,maxItems:48,items:{type:'object',required:['kind','text','references'],additionalProperties:false,properties:{
    kind:{enum:['goal','constraint','decision','completed','pending','evidence']},text:{type:'string',minLength:1,maxLength:2000},
    references:{type:'array',minItems:1,maxItems:8,items:{oneOf:[
      {type:'object',required:['section','digest'],additionalProperties:false,properties:{section:{const:'request'},digest:CONTEXT_DIGEST}},
      {type:'object',required:['section','messageIndex','digest'],additionalProperties:false,properties:{section:{const:'message'},messageIndex:{type:'integer',minimum:0,maximum:Number.MAX_SAFE_INTEGER},digest:CONTEXT_DIGEST}},
    ]}},
  }}},
}}]};
const OBSERVED_USAGE={type:'object',description:'Only actual executor-reported counts. Omit when unavailable; never estimate.',additionalProperties:false,properties:{cachedInputTokens:{type:'integer',minimum:0,maximum:Number.MAX_SAFE_INTEGER,description:'Reported cached portion of total inputTokens; omit when unknown.'},inputTokens:{type:'integer',minimum:0,maximum:Number.MAX_SAFE_INTEGER},outputTokens:{type:'integer',minimum:0,maximum:Number.MAX_SAFE_INTEGER}}};
const RENEW_TOOL={name:'renew_execution',description:'Extend the current live execution lease without restarting work. Use before five minutes pass during long work. Cannot revive expired, paused, or superseded ownership.',inputSchema:{type:'object',required:['taskId','executionId','generation'],additionalProperties:false,properties:{taskId:{type:'string'},executionId:{type:'string'},generation:{type:'integer'},leaseMs:{type:'integer',minimum:1000,maximum:3600000}}}};
const MODELS_TOOL={name:'available_models',description:'Read the current desktop account model catalog and supported Claude role aliases before cross-provider allocation. Empty Codex catalog means reconnect the desktop; do not guess.',inputSchema:{type:'object',properties:{},additionalProperties:false}};
const OWNER={taskId:{type:'string'},executionId:{type:'string'},generation:{type:'integer'}};
const REVIEW={type:'array',minItems:2,maxItems:2,items:{type:'object',required:['childTaskId','criteria'],additionalProperties:false,properties:{childTaskId:{type:'string'},criteria:{type:'array',minItems:1,maxItems:8,items:{type:'object',required:['criterion','status','evidence'],additionalProperties:false,properties:{criterion:{type:'string'},status:{enum:['pass','fail','unverifiable']},evidence:{type:'string',maxLength:2000}}}}}}};
const DELEGATE_TOOL={name:'delegate_task',description:'After understanding the request, select sufficient supported models and delegate exactly two independent source-free assignments, one Codex and one Claude. Durable dispatch replaces this master lease; stop writing afterward.',inputSchema:{type:'object',required:['taskId','executionId','generation','independent','children'],additionalProperties:false,properties:{...OWNER,usage:OBSERVED_USAGE,independent:{const:true},content:{type:'string',maxLength:12000},children:{type:'array',minItems:2,maxItems:2,items:{type:'object',required:['role','provider','requestedModel','effort','sufficientReason','acceptanceCriteria','instructions'],additionalProperties:false,properties:{role:{type:'string',maxLength:100},provider:{enum:['codex','claude']},requestedModel:{type:'string',maxLength:100},effort:{enum:['none','minimal','low','medium','high','xhigh','max']},sufficientReason:{type:'string',maxLength:1000},acceptanceCriteria:{type:'array',minItems:1,maxItems:8,items:{type:'string',maxLength:1000}},instructions:{type:'string',maxLength:12000}}}}}}};
function delegationTool(sourceDelegationVersion){
 if(sourceDelegationVersion!==1)return DELEGATE_TOOL;
 const tool=structuredClone(DELEGATE_TOOL);
 tool.description='After understanding the request, select sufficient models for two independent assignments, one Codex and one Claude. Choose sourceIds only from this parent task; never copy original text into instructions. After allocation stop writing under the old lease.';
 tool.inputSchema.properties.children.items.properties.sourceIds={type:'array',maxItems:20,uniqueItems:true,items:{type:'string',minLength:1,maxLength:200},description:'Parent attachment IDs needed by this child; omitted means no source access. Source content must not be included.'};
 return tool;
}
const RETRY_TOOL={name:'retry_delegation',description:'During final review, retry only children with explicit failed acceptance criteria, at most once per batch. Completed siblings stay preserved.',inputSchema:{type:'object',required:['taskId','executionId','generation','reviewReport'],additionalProperties:false,properties:{...OWNER,usage:OBSERVED_USAGE,reviewReport:REVIEW}}};
const HANDOFF_TOOL={
 name:'handoff_task',description:'Sequentially hand off to the other subscription provider, with no source attachments and at most two transitions. Save generated progress, then stop writing under the old lease.',
 inputSchema:{type:'object',required:['taskId','executionId','generation','content','handoff'],additionalProperties:false,properties:{
  taskId:{type:'string'},executionId:{type:'string'},generation:{type:'integer'},usage:OBSERVED_USAGE,content:{type:'string',maxLength:12000},
  handoff:{type:'object',required:['provider','instructions','reason','acceptance'],additionalProperties:false,properties:{provider:{enum:['codex','claude']},instructions:{type:'string',maxLength:12000},reason:{type:'string',maxLength:1000},acceptance:{type:'string',maxLength:2000}}}
 }}
};
const TOOLS = Object.freeze([
  {
    name: 'list_tasks',
    description: 'List durable INNO Workspace tasks. Source attachment bytes are never returned.',
    inputSchema: {type: 'object', properties: {}, additionalProperties: false},
  },
  {
    name: 'read_task',
    description: 'Read one durable task by ID.',
    inputSchema: {
      type: 'object', required: ['taskId'], additionalProperties: false,
      properties: {taskId: {type: 'string'}},
    },
  },
  {
    name: 'read_task_context',
    description: 'Read one bounded durable context section within the same task scope as read_task; never starts AI work. Supply the current task expectedVersion. If unknown, request manifest with expectedVersion:0; an authorized version conflict returns only conflict, taskId and currentVersion. Text offsets are UTF-8 bytes; pages default to at most 16000 bytes. Every text continuation (offset > 0) requires the previous contentDigest as expectedDigest. On version conflict, reread manifest using the returned currentVersion. On digest mismatch, reread manifest using the same expectedVersion. Restart text at offset 0; do not combine revisions. Manifest offsets are message indexes and return at most 20 metadata-only entries; maxBytes, messageIndex and expectedDigest are not valid for manifest. Basis returns source digests for an optional messageCount prefix. Resume returns verified derived state only when source_matched; this proves source agreement only, never semantic completeness, quality or approval authority. Resume pendingMessageIndexes contains at most 20 indexes; pendingMessageCount reports the total and nextPendingMessageIndex, when non-null, can be used as the manifest offset to inspect further pending references. Basis/resume reject offset, maxBytes, expectedDigest and messageIndex; resume also rejects messageCount. No source attachment or artifact bodies are returned.',
    annotations: {readOnlyHint:true, destructiveHint:false},
    inputSchema: {
      type:'object', required:['taskId','expectedVersion','section'], additionalProperties:false,
      properties: {
        taskId:{type:'string'}, expectedVersion:{type:'integer',minimum:0,maximum:Number.MAX_SAFE_INTEGER},
        section:{enum:['request','checkpoint','message','manifest','basis','resume']},
        messageCount:{type:'integer',minimum:0,maximum:Number.MAX_SAFE_INTEGER,description:'Basis section only: number of original messages covered; defaults to all.'},
        messageIndex:{type:'integer',minimum:0,maximum:Number.MAX_SAFE_INTEGER,description:'Required only for the message section; zero-based message index.'},
        offset:{type:'integer',minimum:0,maximum:Number.MAX_SAFE_INTEGER,description:'UTF-8 byte offset for text; message index for manifest. Defaults to 0.'},
        maxBytes:{type:'integer',minimum:4,maximum:16000,default:16000,description:'Text sections only.'},
        expectedDigest:{type:'string',pattern:'^[0-9a-f]{64}$',description:'Text sections only. Full content SHA-256; required for continuation offsets greater than zero.'},
      },
    },
  },
  {
    name: 'claim_execution',
    description: 'Acquire the single durable execution lease for a task.',
    inputSchema: {
      type: 'object', required: ['taskId', 'provider', 'expectedVersion'], additionalProperties: false,
      properties: {
        taskId: {type: 'string'}, provider: {enum: ['codex', 'claude']},
        expectedVersion: {type: 'integer'}, leaseMs: {type: 'integer', minimum: 1000, maximum: 3600000},
      },
    },
  },
  {
    name: 'checkpoint_task',
    description: 'Write a checkpoint while holding the current execution ID and generation. Set status completed only after producing and verifying the result.',
    inputSchema: {
      type: 'object', required: ['taskId', 'executionId', 'generation', 'content'], additionalProperties: false,
      properties: {
        taskId: {type: 'string'}, executionId: {type: 'string'}, generation: {type: 'integer'}, usage:OBSERVED_USAGE, content: {type: 'string'},
        status: {enum: ['running', 'completed']}, summary: {type: 'string'}, reviewReport:REVIEW, resumeState:RESUME_STATE,
      },
    },
  },
  {
    name: 'artifact_task',
    description: 'Store a generated artifact while holding the current execution ID and generation. Inline artifact JSON is limited to 500,000 UTF-8 bytes (about 375 KB raw when base64 encoded).',
    inputSchema: {
      type: 'object', required: ['taskId', 'executionId', 'generation', 'artifact'], additionalProperties: false,
      properties: {
        taskId: {type: 'string'}, executionId: {type: 'string'}, generation: {type: 'integer'},
        artifact: {
          type: 'object', required: ['name', 'mime', 'content'], additionalProperties: false,
          properties: {
            checks: {type:'array',maxItems:20,items:{type:'object',required:['check','status','evidence'],additionalProperties:false,properties:{check:{type:'string',minLength:1,maxLength:200},status:{enum:['pass','fail','not_run']},evidence:{type:'string',minLength:1,maxLength:1500}}}},
            name: {type: 'string'}, mime: {type: 'string'}, content: {type: 'string'}, encoding: {enum: ['utf-8', 'base64']},
          },
        },
      },
    },
  },
  {
    name: 'plan_task',
    description: 'Replace the bounded role plan while holding the current execution ID and generation.',
    inputSchema: {
      type: 'object', required: ['taskId', 'executionId', 'generation', 'plan'], additionalProperties: false,
      properties: {
        taskId: {type: 'string'}, executionId: {type: 'string'}, generation: {type: 'integer'}, plan: {type: 'array', maxItems: 6},
      },
    },
  },
  {
    name: 'request_decision',
    description: 'Pause the current execution and request a user decision with 2 to 5 explicit options and their tradeoffs.',
    inputSchema: {
      type: 'object', required: ['taskId', 'executionId', 'generation', 'prompt', 'options'], additionalProperties: false,
      properties: {
        taskId: {type: 'string'}, executionId: {type: 'string'}, generation: {type: 'integer'}, usage:OBSERVED_USAGE, prompt: {type: 'string'},
        options: {
          type: 'array', minItems: 2, maxItems: 5,
          items: {
            type: 'object', required: ['label', 'pros', 'cons'], additionalProperties: false,
            properties: {label: {type: 'string'}, pros: {type: 'string'}, cons: {type: 'string'}},
          },
        },
      },
    },
  },
]);

const acknowledgement=task=>({id:task.id,status:task.status,version:task.version});
const allocationAcknowledgement=result=>({parent:acknowledgement(result.parent),children:(result.children??[]).map(acknowledgement),replayed:result.replayed===true});
function toolResult(value) {
  return {content: [{type: 'text', text: JSON.stringify(value)}]};
}

async function callTool(store, name, args = {}, handlers = {}) {
  switch (name) {
    case 'renew_execution':
      if(typeof store.renewExecution!=='function')throw new Error('Execution renewal unavailable');
      return toolResult({task:await store.renewExecution(args.taskId,args)});
    case 'available_models':
      if(!handlers.models)throw new Error('Model catalog unavailable');
      return toolResult(await handlers.models());
    case 'delegate_task':
      if(!handlers.delegate)throw new Error('Delegation is unavailable in this environment');
      return toolResult(allocationAcknowledgement(await handlers.delegate(args)));
    case 'retry_delegation':
      if(!handlers.retryReview)throw new Error('Delegation retry is unavailable in this environment');
      return toolResult(allocationAcknowledgement(await handlers.retryReview(args)));
    case 'handoff_task':
      if(!handlers.handoff)throw new Error('Provider handoff is unavailable in this environment');
      return toolResult({task:acknowledgement(await handlers.handoff(args))});
    case 'list_tasks':
      return toolResult({tasks: handlers.listTasks?await handlers.listTasks():await store.listTasks()});
    case 'read_task': {
      const task = handlers.readTask?await handlers.readTask(args.taskId):await store.requireTask(args.taskId);
      return toolResult({task});
    }
    case 'read_task_context': {
      const task = handlers.readTask?await handlers.readTask(args.taskId):await store.requireTask(args.taskId);
      try {
        return toolResult(await readTaskContext(task,args));
      } catch(error) {
        if(error?.code==='CONTEXT_VERSION_CONFLICT'&&error.statusCode===409&&Number.isSafeInteger(error.currentVersion)&&error.currentVersion>0&&error.currentVersion===task.version)
          return {...toolResult({conflict:'context_version',taskId:task.id,currentVersion:error.currentVersion}),isError:true};
        throw error;
      }
    }
    case 'claim_execution':
      return toolResult(await store.claimExecution(args.taskId, args));
    case 'checkpoint_task': {
      if (args.status === 'completed' && args.resumeState !== undefined)throw new Error('Resume state is not supported on completed checkpoints');
      if (args.status === 'completed') {
        const current=await store.requireTask(args.taskId);
        if(current.status==='completed'&&current.checkpoint?.executionId===args.executionId&&current.checkpoint?.generation===args.generation)return toolResult({task:current});
        const task = await store.finishExecution(args.taskId, {
          executionId: args.executionId,
          generation: args.generation,
          usage: args.usage,
          content: args.summary || args.content,
          checkpoint: args.content,
          reviewReport: args.reviewReport,
        });
        await handlers.afterComplete?.(task);
        return toolResult({task});
      }
      const task = await store.applyExecutionAction(args.taskId, {...args, action: 'checkpoint'});
      return args.resumeState !== undefined
        ? toolResult({task:acknowledgement(task),resumeStateSaved:args.resumeState!==null})
        : toolResult({task});
    }
    case 'artifact_task': {
      const task = await store.applyExecutionAction(args.taskId, {...args, action: 'artifact'});
      return toolResult({task});
    }
    case 'plan_task': {
      const task = await store.applyExecutionAction(args.taskId, {...args, action: 'plan'});
      return toolResult({task});
    }
    case 'request_decision': {
      const task = await store.requestDecision(args.taskId, args);
      return toolResult({task});
    }
    default:
      throw new Error(`unknown tool: ${name}`);
  }
}

export async function handleMcp(store, message, handlers = {}) {
  const id = message?.id ?? null;
  if (!message || message.jsonrpc !== '2.0' || typeof message.method !== 'string') {
    return {jsonrpc: '2.0', id, error: {code: -32600, message: 'Invalid Request'}};
  }
  if (message.method === 'initialize') {
    return {
      jsonrpc: '2.0', id,
      result: {
        protocolVersion: '2025-06-18',
        capabilities: {tools: {listChanged: false}},
        serverInfo: {name: 'inno-workspace', version: '0.1.0'},
      },
    };
  }
  if (message.method === 'ping') return {jsonrpc: '2.0', id, result: {}};
  if (message.method === 'tools/list') return {jsonrpc:'2.0',id,result:{tools:[...TOOLS,...(typeof store.renewExecution==='function'?[RENEW_TOOL]:[]),...(handlers.models?[MODELS_TOOL]:[]),...(handlers.handoff?[HANDOFF_TOOL]:[]),...(handlers.delegate?[delegationTool(handlers.sourceDelegationVersion)]:[]),...(handlers.retryReview?[RETRY_TOOL]:[])]}};
  if (message.method === 'tools/call') {
    try {
      const result = await callTool(store, message.params?.name, message.params?.arguments ?? {}, handlers);
      return {jsonrpc: '2.0', id, result};
    } catch (error) {
      return {
        jsonrpc: '2.0', id,
        result: {
          isError: true,
          content: [{type: 'text', text: error instanceof Error ? error.message : String(error)}],
        },
      };
    }
  }
  return {jsonrpc: '2.0', id, error: {code: -32601, message: 'Method not found'}};
}
