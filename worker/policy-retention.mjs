// Reads only saved selection references from nonterminal tasks. The result cap is
// deliberately fail closed: cleanup and observation ingestion must not guess pins.
export const TASK_PIN_LIMIT=512;
const hasEvidenceIds=path=>`(json_type(body,'${path}') IS NOT NULL AND (json_type(body,'${path}') != 'array' OR json_array_length(body,'${path}') > 0))`;
export const TASK_PINS_SQL=`SELECT
 json_extract(body,'$.assignment.selection.evidenceIds') AS own,
 json_extract(body,'$.delegation.children[0].selection.evidenceIds') AS first_child,
 json_extract(body,'$.delegation.children[1].selection.evidenceIds') AS second_child,
 json_array_length(body,'$.delegation.children') AS child_count
 FROM tasks
 WHERE json_extract(body,'$.status') IN ('ready','queued','waiting_children','queued_for_review','running','paused','waiting_user','waiting_quota','waiting_connection','failed')
 AND (${hasEvidenceIds('$.assignment.selection.evidenceIds')}
   OR ${hasEvidenceIds('$.delegation.children[0].selection.evidenceIds')}
   OR ${hasEvidenceIds('$.delegation.children[1].selection.evidenceIds')}
   OR json_array_length(body,'$.delegation.children')>2)
 LIMIT ${TASK_PIN_LIMIT+1}`;

export function parseTaskEvidencePins(rows){
 if(rows.length>TASK_PIN_LIMIT)throw new Error('model policy retention deferred: task pin scan limit');
 const pins=new Set();
 for(const row of rows){
  if(row.child_count>2)throw new Error('model policy retention deferred: unsupported task selection shape');
  for(const field of ['own','first_child','second_child']){
  if(row[field]===null||row[field]===undefined)continue;
  let ids;
  try{ids=JSON.parse(row[field]);}catch{throw new Error('model policy retention deferred: invalid task evidence');}
  if(!Array.isArray(ids)||ids.length>1000||ids.some(id=>typeof id!=='string'||!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/.test(id)))throw new Error('model policy retention deferred: invalid task evidence');
  for(const id of ids)pins.add(id);
  }
 }
 return [...pins];
}
