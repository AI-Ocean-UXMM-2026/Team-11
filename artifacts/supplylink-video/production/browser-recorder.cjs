const { chromium } = require('C:/Users/USER/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const fs = require('node:fs/promises');
const path = require('node:path');
const http = require('node:http');
const root = path.resolve('artifacts/supplylink-video');
const base = 'http://127.0.0.1:3105';
let browser;
const pages = {}, contexts = {}, marks = [];
let videoEpoch = {};
async function init() {
  browser = await chromium.launch({headless:true});
  console.log('BROWSER_READY');
}
async function role(name, username, record=false) {
  const context = await browser.newContext({viewport:{width:1600,height:800},deviceScaleFactor:1,...(record ? {recordVideo:{dir:path.join(root,'raw'),size:{width:1600,height:800}}}: {})});
  const res = await context.request.post(base+'/api/auth/'+name+'/login',{headers:{Origin:base},data:{username,password:'OceanPrideDemo-2026!'}});
  if (!res.ok()) throw new Error(await res.text());
  // Explicit local HTTP demo only: APIRequestContext requires a non-secure cookie.
  await context.addCookies((await context.cookies()).map(c=>({...c,secure:false})));
  contexts[name]=context;
  pages[name]=await context.newPage();
  videoEpoch[name]=Date.now();
  return pages[name];
}
async function snap(name,label) {
  const p=pages[name];
  await p.screenshot({path:path.join(root,'frames',label+'.png')});
  return (await p.locator('body').innerText()).slice(0,18000);
}
async function act(name,action,payload) {
  const res=await contexts[name].request.post(base+'/api/workflow',{headers:{Origin:base},data:{action,payload,key:crypto.randomUUID()}});
  const body=await res.json(); if(!res.ok()||body.error) throw new Error(action+': '+JSON.stringify(body));
  return body;
}
async function data(name='hq') {
  return (await (await contexts[name].request.get(base+'/api/workflow')).json()).data;
}
async function mark(name,label,seconds=7) {
  const start=(Date.now()-videoEpoch[name])/1000;
  await pages[name].waitForTimeout(seconds*1000);
  marks.push({role:name,label,start,duration:seconds});
  await fs.writeFile(path.join(root,'production','marks.json'),JSON.stringify(marks,null,2));
  return {label,start,duration:seconds};
}
async function finish() {
  const videos={};
  for(const [name,p] of Object.entries(pages)) {
    const v=p.video();
    await contexts[name].close();
    if(v) { const target=path.join(root,'raw',name+'.webm'); await v.saveAs(target); videos[name]=target; }
  }
  await fs.writeFile(path.join(root,'production','videos.json'),JSON.stringify(videos,null,2));
  await browser.close(); return videos;
}
const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
const server=http.createServer(async(req,res)=>{
  if(req.method!=='POST'){res.end('SupplyLink local video recorder');return;}
  try {
    let body='';for await(const chunk of req) body+=chunk;
    const {code}=JSON.parse(body);
    const result=await eval('(async()=>{'+code+'})()');
    res.setHeader('Content-Type','application/json'); res.end(JSON.stringify({ok:true,result}));
  }catch(error){res.statusCode=500;res.end(JSON.stringify({ok:false,error:error.stack}));}
});
init().then(()=>server.listen(3199,'127.0.0.1',()=>console.log('RECORDER http://127.0.0.1:3199')));
