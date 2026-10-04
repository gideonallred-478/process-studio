export class MemoryR2 {
 constructor(){this.items=new Map();this.rangeReads=[];}
 async put(key,value,options={}){const old=this.items.get(key);if(options.onlyIf?.etagMatches&&old?.etag!==options.onlyIf.etagMatches)return null;if(options.onlyIf?.etagDoesNotMatch==='*'&&old)return null;const bytes=typeof value==='string'?Buffer.from(value):Buffer.from(await new Response(value).arrayBuffer());const item={bytes,size:bytes.length,etag:crypto.randomUUID(),httpMetadata:options.httpMetadata||{}};this.items.set(key,item);return item;}
 async head(key){const item=this.items.get(key);return item?{size:item.size,etag:item.etag,httpMetadata:item.httpMetadata}:null;}
 async get(key,options={}){const item=this.items.get(key);if(!item)return null;let bytes=item.bytes;if(options.range){this.rangeReads.push({key,...options.range});bytes=bytes.subarray(options.range.offset,options.range.offset+options.range.length);}return {...item,body:new Response(bytes).body,json:async()=>JSON.parse(item.bytes),arrayBuffer:async()=>bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength)};}
 async delete(key){for(const name of Array.isArray(key)?key:[key])this.items.delete(name);}
 async list({prefix='',limit=1000,cursor}={}){const keys=[...this.items.keys()].filter(k=>k.startsWith(prefix)).sort(),offset=Number(cursor||0),page=keys.slice(offset,offset+limit);return {objects:page.map(key=>({key})),truncated:offset+limit<keys.length,cursor:String(offset+limit)};}
}
