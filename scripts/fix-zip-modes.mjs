// Compress-Archive on Windows does not preserve Unix execute bits.
// Update only ZIP metadata so macOS can double-click .command installers.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
export function portableZip(buffer) {
  let end = buffer.length - 22;
  while(end >= Math.max(0,buffer.length-65557) && buffer.readUInt32LE(end)!==0x06054b50)end--;
  if(end<0)throw Error('ZIP end record missing');
  const total=buffer.readUInt16LE(end+10);let offset=buffer.readUInt32LE(end+16);const entries=[];
  for(let i=0;i<total;i++){
    if(buffer.readUInt32LE(offset)!==0x02014b50)throw Error('ZIP central directory invalid');
    const length=buffer.readUInt16LE(offset+28), extra=buffer.readUInt16LE(offset+30), comment=buffer.readUInt16LE(offset+32);
    const bytes=buffer.subarray(offset+46,offset+46+length);for(let n=0;n<bytes.length;n++)if(bytes[n]===92)bytes[n]=47;
    const name=bytes.toString('utf8'), directory=name.endsWith('/');
    const executable=/\.command$|\.sh$|\/darwin-(?:arm64|x64)\/(?:node|cloudflared)$/.test(name);
    const mode=directory?0o40755:executable?0o100755:0o100644;
    buffer.writeUInt16LE((3<<8)|20,offset+4);buffer.writeUInt32LE(mode*65536+(directory?16:0),offset+38);
    const local=buffer.readUInt32LE(offset+42);if(buffer.readUInt32LE(local)!==0x04034b50)throw Error('ZIP local header invalid');
    const localName=buffer.subarray(local+30,local+30+buffer.readUInt16LE(local+26));for(let n=0;n<localName.length;n++)if(localName[n]===92)localName[n]=47;
    entries.push({name,mode});offset+=46+length+extra+comment;
  }
  return entries;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const file=process.argv[2];const bytes=fs.readFileSync(file);const entries=portableZip(bytes);fs.writeFileSync(file,bytes);console.log('ZIP portability metadata verified: '+entries.length+' entries');
}
