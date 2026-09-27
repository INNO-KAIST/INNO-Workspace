import vm from 'node:vm';
import {readFileSync} from 'node:fs';
export async function officeFixture(main='word/document.xml') {const context={module:{exports:{}},setImmediate,setTimeout,clearTimeout,Buffer,Uint8Array,Uint16Array,Uint32Array,ArrayBuffer};context.exports=context.module.exports;vm.runInNewContext(readFileSync(new URL('../../public/vendor/jszip.min.js',import.meta.url),'utf8'),context);const zip=new context.module.exports();for(const name of ['[Content_Types].xml','_rels/.rels',main])zip.file(name,'<test/>');return new Uint8Array(await zip.generateAsync({type:'uint8array'}));}
