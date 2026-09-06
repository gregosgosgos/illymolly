/* 남의 PDF 뷰어(Mozilla pdf.js)로 우리 PDF 를 렌더 — 진짜 검증 */
import { chromium } from 'playwright';
import http from 'http'; import fs from 'fs'; import path from 'path';
const root=process.cwd(), SP=process.env.SP, FILE=process.env.FILE;
const MIME={'.html':'text/html','.mjs':'text/javascript','.js':'text/javascript','.css':'text/css','.pdf':'application/pdf','.woff':'font/woff'};
const srv=http.createServer((q,r)=>{
  let u=decodeURIComponent(q.url.split('?')[0]);
  let p = u.startsWith('/sp/') ? path.join(SP, u.slice(4)) : path.join(root, u);
  if (u === '/__blank') { r.writeHead(200,{'content-type':'text/html'}); r.end('<!doctype html><body>'); return; }
  fs.readFile(p,(e,d)=>{if(e){r.writeHead(404);r.end('x');return;}r.writeHead(200,{'content-type':MIME[path.extname(p)]||'application/octet-stream'});r.end(d);});});
await new Promise(r=>srv.listen(8086,r));
const b=await chromium.launch(); const pg=await b.newPage({viewport:{width:1000,height:700}});
const errs=[]; pg.on('pageerror',e=>errs.push(String(e))); pg.on('console',m=>{if(m.type()==='error')errs.push(m.text())});
await pg.goto('http://localhost:8086/__blank');
await pg.setContent(`<body style="margin:0;background:#fff"><canvas id="c"></canvas></body>`);
const out = await pg.evaluate(async file => {
  const pdfjs = await import('http://localhost:8086/node_modules/pdfjs-dist/build/pdf.mjs');
  pdfjs.GlobalWorkerOptions.workerSrc = 'http://localhost:8086/node_modules/pdfjs-dist/build/pdf.worker.mjs';
  const doc = await pdfjs.getDocument({ url: file }).promise;
  const oc = await doc.getOptionalContentConfig();
  const groups = [...(oc?.getGroups?.() ? Object.entries(oc.getGroups()) : [])]
    .map(([id, g]) => (g?.name ?? g) + (oc.isVisible({type:'OCG', id}) ? '' : '(숨김)'));
  const page = await doc.getPage(1);
  const vp = page.getViewport({ scale: 2 });
  const c = document.getElementById('c');
  c.width = vp.width; c.height = vp.height;
  await page.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
  const tc = await page.getTextContent();
  return { text: tc.items.map(i => i.str).join('|'), w: vp.width, h: vp.height, pages: doc.numPages, groups };
}, 'http://localhost:8086/sp/' + FILE);
console.log('pdf.js 렌더:', out.w+'x'+out.h, '· 페이지', out.pages, '· 레이어:', out.groups.join(' / ') || '(없음)');
console.log('추출한 텍스트:', out.text);
console.log('오류:', errs.slice(0,3));
const el = await pg.$('#c');
await el.screenshot({path: SP + '/' + FILE.replace(/\.\w+$/,'') + '-pdfjs.png'});
await b.close(); srv.close();
