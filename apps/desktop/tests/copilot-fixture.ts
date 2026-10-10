import { mkdtemp, realpath, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import {
  SupervisedCopilotClient,
  type CopilotSupervisorOptions,
} from "../src/main/ai/copilot-supervisor";
import { copilotClientOptions } from "../src/main/ai/copilot-runtime";
import { toolEnvironment } from "../src/main/ai/tool-detection";

export const fixtureSession = "0197bec5-f130-7416-9e05-21d028962ef8";
export type FixtureMode =
  | "normal"
  | "startup-hang"
  | "send-hang"
  | "stop-hang"
  | "runtime-exit"
  | "policy-single"
  | "policy-burst"
  | "policy";
export async function waitFor<T>(
  read: () => Promise<T>,
  accepted: (value: T) => boolean,
  timeout = 5000,
): Promise<T> {
  const deadline = Date.now() + timeout;
  do {
    try {
      const value = await read();
      if (accepted(value)) return value;
    } catch {
      // Markers may not exist until their owned process reaches this stage.
    }
    await delay(20);
  } while (Date.now() < deadline);
  throw new Error(
    "Copilot fixture did not reach its bounded observable state.",
  );
}
export async function processRunning(pid: number): Promise<boolean> {
  if (process.platform === "linux") {
    try {
      const stat = await readFile(`/proc/${pid}/stat`, "utf8");
      return stat.slice(stat.lastIndexOf(")") + 2).split(" ")[0] !== "Z";
    } catch (error) {
      if (
        error instanceof Error &&
        "code" in error &&
        ["ENOENT", "ESRCH"].includes(String(error.code))
      )
        return false;
      throw error;
    }
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
export async function copilotProcessFixture(
  mode: FixtureMode = "normal",
  supervisor: CopilotSupervisorOptions = {},
) {
  const root = await mkdtemp(
    path.join(await realpath(tmpdir()), "prmonitor-copilot-owner-"),
  );
  const executable = path.join(root, "runtime.js");
  // These are synthetic Node grandchildren, not provider programs. The only
  // writes are heartbeat/identity/contract files inside the owned fixture root.
  await writeFile(
    path.join(root, "grandchild.cjs"),
    `
const fs=require("node:fs"); const root=__dirname;
fs.writeFileSync(root+"/grandchild.pid",String(process.pid));
process.on("SIGTERM",()=>{}); let n=0;
setInterval(()=>fs.writeFileSync(root+"/heartbeat",String(++n)),20);
setTimeout(()=>process.exit(0),20000);
`,
  );
  await writeFile(
    path.join(root, "child.cjs"),
    `
const fs=require("node:fs"); const {spawn}=require("node:child_process"); const root=__dirname;
fs.writeFileSync(root+"/child.pid",String(process.pid));
spawn(process.execPath,[root+"/grandchild.cjs"],{stdio:["ignore","inherit","inherit"],env:process.env});
process.on("SIGTERM",()=>{}); setInterval(()=>{},1000); setTimeout(()=>process.exit(0),20000);
`,
  );
  await writeFile(
    executable,
    `
const fs=require("node:fs"); const {spawn}=require("node:child_process"); const root=__dirname;
const mode=${JSON.stringify(mode)}; let sessionId=${JSON.stringify(fixtureSession)};
fs.writeFileSync(root+"/runtime.pid",String(process.pid));
fs.writeFileSync(root+"/worker.pid",String(process.ppid));
fs.writeFileSync(root+"/environment.json",JSON.stringify(process.env));
spawn(process.execPath,[root+"/child.cjs"],{stdio:["ignore","inherit","inherit"],env:process.env});
process.on("SIGTERM",()=>{}); setTimeout(()=>process.exit(0),20000); setInterval(()=>{},1000);
let buffer=Buffer.alloc(0),hookSequence=10000; const hooks=new Map();
function send(message) {const body=JSON.stringify({jsonrpc:"2.0",...message});process.stdout.write("Content-Length: "+Buffer.byteLength(body)+"\\r\\n\\r\\n"+body);}
function event(type,data) {send({method:"session.event",params:{sessionId,event:{id:"fixture-event",timestamp:new Date().toISOString(),type,data}}});}
function answer(id) {send({id,result:{messageId:"fixture-message"}});setTimeout(()=>{event("assistant.message",{content:JSON.stringify({schemaVersion:1,interaction:"read_only",answer:"Fixture answer."})});event("session.idle",{});},10);}
function receive(message) {
 if(!message.method) {const pending=hooks.get(message.id);if(pending){hooks.delete(message.id);pending(message.result);}return;}
 fs.appendFileSync(root+"/requests.jsonl",JSON.stringify(message)+"\\n");
 const id=message.id,params=message.params||{}; let result={};
 switch(message.method) {
 case "connect":if(mode==="startup-hang")return;result={protocolVersion:3};break;
 case "auth.getStatus":result={isAuthenticated:true,authType:"user",host:"github.com"};break;
 case "models.list":result={models:[{id:"gpt-5",supportedReasoningEfforts:["medium"]}]};break;
 case "hooks.discover":result={hooks:[],errors:[]};break;
 case "tools.list":result={tools:["view","glob","grep","edit","create"].map(name=>({name,parameters:{properties:{path:{type:"string"}}}}))};break;
 case "session.create":case "session.resume":sessionId=params.sessionId||sessionId;result={sessionId};fs.writeFileSync(root+"/settings.json",JSON.stringify(params));break;
 case "session.model.getCurrent":result={modelId:"gpt-5"};break;
 case "session.detach":result={success:true};break;
 case "session.send":
  fs.writeFileSync(root+"/sent",String(process.pid));
  if(mode==="send-hang")return;
  if(mode==="runtime-exit"){setTimeout(()=>process.exit(1),10);return;}
  if(mode==="policy-burst") {
   const decisions=[]; let remaining=32;
   const requestHook=(onReply)=>{const request=++hookSequence;hooks.set(request,onReply);send({id:request,method:"hooks.invoke",params:{sessionId,hookType:"preToolUse",input:{sessionId,timestamp:new Date().toISOString(),workingDirectory:root,toolName:"view",toolArgs:{path:"inside.txt"}}}});};
   for(let n=0;n<32;n++)requestHook(value=>{decisions.push(value);if(--remaining===0)requestHook(value=>{decisions.push(value);fs.writeFileSync(root+"/policy.json",JSON.stringify(decisions));answer(id);});});return;
  }
  if(mode==="policy" || mode==="policy-single") {
   const checks=mode==="policy-single"?[{args:{path:"inside.txt"}}]:[{args:{path:"inside.txt"}},{args:{path:"../outside.txt"}}, {args:{path:"inside.txt"},sessionId:"unrelated-session"},{args:{path:"inside.txt"},workingDirectory:require("node:path").dirname(root)},{args:{path:"inside.txt"},toolName:"bash"},{args:{path:"x".repeat(256*1024)}}];let index=0;const decisions=[];
   const next=()=>{if(index===checks.length){fs.writeFileSync(root+"/policy.json",JSON.stringify(decisions));answer(id);return;}
    const request=++hookSequence,check=checks[index++];hooks.set(request,value=>{decisions.push(value);next();});
    send({id:request,method:"hooks.invoke",params:{sessionId,hookType:"preToolUse",input:{sessionId:check.sessionId||sessionId,timestamp:new Date().toISOString(),workingDirectory:check.workingDirectory||root,toolName:check.toolName||"view",toolArgs:check.args}}});};next();return;
  }
  answer(id);return;
 case "runtime.shutdown":if(mode==="stop-hang")return;break;
 }
 if(id!==undefined)send({id,result});
}
process.stdin.on("data",data=>{buffer=Buffer.concat([buffer,data]);while(true){const split=buffer.indexOf("\\r\\n\\r\\n");if(split<0)return;const length=Number(buffer.subarray(0,split).toString().match(/Content-Length: (\\d+)/i)?.[1]);if(!length||length>2*1024*1024)process.exit(1);if(buffer.length<split+4+length)return;const message=JSON.parse(buffer.subarray(split+4,split+4+length));buffer=buffer.subarray(split+4+length);receive(message);}});
process.stdin.resume();
`,
  );
  await writeFile(path.join(root, "inside.txt"), "synthetic input");
  const connection = {
    id: "fixture",
    name: "Fixture",
    tool: "copilot" as const,
    executable,
    extraArgs: [],
    authMode: "subscription" as const,
    signInSource: "existing" as const,
    revision: 1,
  };
  const env = {
    ...toolEnvironment("copilot", "subscription"),
    HOME: root,
    COPILOT_HOME: root,
  };
  const options = copilotClientOptions(connection, env, root, root);
  const worker = path.resolve("out/main/copilot-worker.js");
  const client = new SupervisedCopilotClient(options, {
    worker,
    shutdownTimeoutMs: 100,
    ...supervisor,
  });
  return {
    root,
    client,
    options,
    worker,
    env,
    async identities() {
      return Promise.all(
        ["runtime", "child", "grandchild"].map((name) =>
          waitFor(
            async () =>
              Number(await readFile(path.join(root, name + ".pid"), "utf8")),
            (value) => Number.isSafeInteger(value) && value > 0,
          ),
        ),
      );
    },
    async heartbeat() {
      return Number(await readFile(path.join(root, "heartbeat"), "utf8"));
    },
  };
}
