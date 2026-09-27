const KEY='desktop_workspace_id';
const UUID_V4=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function checked(row){
 if(typeof row?.value!=='string'||!UUID_V4.test(row.value))throw new Error('Invalid workspace identity');
 return row.value;
}

export async function workspaceIdentity(db){
 const read=()=>db.prepare('SELECT value FROM metadata WHERE key=?1').bind(KEY).first();
 const existing=await read();
 if(existing)return checked(existing);
 await db.prepare('INSERT OR IGNORE INTO metadata(key,value) VALUES(?1,?2)').bind(KEY,crypto.randomUUID()).run();
 return checked(await read());
}
