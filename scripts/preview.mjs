import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve,extname,sep} from 'node:path';
const root=resolve('preview');
createServer(async(req,res)=>{if(req.method!=='GET'&&req.method!=='HEAD'){res.writeHead(405);return res.end();}try{const path=resolve(root,'.'+decodeURIComponent(new URL(req.url,'http://localhost').pathname.replace(/\/$/,'/index.html')));if(!path.startsWith(root+sep))throw Error();const data=await readFile(path);res.writeHead(200,{'Content-Type':extname(path)==='.html'?'text/html; charset=utf-8':'application/octet-stream','Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src 'self' data:; connect-src 'none'",'Cache-Control':'no-store'});res.end(req.method==='HEAD'?undefined:data);}catch{res.writeHead(404);res.end('Not found');}}).listen(8145,'127.0.0.1',()=>console.log('Fictional preview: http://127.0.0.1:8145/ â€” no Azure, SQL, sign-in or email connection.'));
