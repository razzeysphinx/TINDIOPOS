import { randomUUID } from "node:crypto";
import process from "node:process";
import { createClient } from "@supabase/supabase-js";
import { reconcileInventoryState } from "./lib/inventory-reconciliation.mjs";
import { parseAndValidateLocalSupabaseStatus } from "./lib/certification-safety.mjs";
import { runCommand } from "./lib/run-command.mjs";

const ROOT = process.cwd();
const EXPECTED_CONTAINER = "supabase_db_tindio_pos";
let databaseContainer = EXPECTED_CONTAINER;
const fail = (message) => { throw new Error(message); };
const assert = (condition, message) => { if (!condition) fail(message); };
function command(name,args){const result=runCommand(name,args,{cwd:ROOT,env:process.env,capture:true});if(result.error||result.status!==0)fail(`${name} failed: ${String(result.stderr??result.error?.message??"unknown")}`);return String(result.stdout??"").trim();}
function query(sql){return command("docker",["exec","-e","PGOPTIONS=-c default_transaction_read_only=on",databaseContainer,"psql","-U","postgres","-d","postgres","-X","-q","-A","-t","-v","ON_ERROR_STOP=1","-c",sql]);}
function fixtureSql(sql){return command("docker",["exec",databaseContainer,"psql","-U","postgres","-d","postgres","-X","-q","-A","-t","-v","ON_ERROR_STOP=1","-c",sql]);}
function sqlUuid(value){if(!/^[0-9a-f-]{36}$/i.test(value))fail("Invalid UUID.");return `'${value}'::uuid`;}
function number(sql){return Number(query(sql));}
function json(sql){return JSON.parse(query(sql));}
async function signIn(client,email,password){const {data,error}=await client.auth.signInWithPassword({email,password});if(error||!data.session)fail(`Sign-in failed: ${error?.message??"no session"}`);}
async function rpc(client,name,args){const {data,error}=await client.rpc(name,args);if(error)fail(`${name}: ${error.code}: ${error.message}`);return data;}
function ruleArgs(org,store,product,reorder,target){return {target_organization_id:org,target_store_id:store,target_product_id:product,target_reorder_point:reorder,target_target_stock:target};}

async function main(){
  console.log("TINDIO REPLENISHMENT SETTINGS CONCURRENCY EVIDENCE");
  const statusOutput=command("pnpm",["exec","supabase","status","--output","json"]);parseAndValidateLocalSupabaseStatus(statusOutput);const status=JSON.parse(statusOutput);
  databaseContainer=command("docker",["ps","--format","{{.Names}}"] ).split(/\r?\n/).find((name)=>name.toLowerCase()===EXPECTED_CONTAINER)??fail("Local database container not found.");
  const admin=createClient(status.API_URL,status.SERVICE_ROLE_KEY,{auth:{persistSession:false}});const a=createClient(status.API_URL,status.ANON_KEY,{auth:{persistSession:false}});const b=createClient(status.API_URL,status.ANON_KEY,{auth:{persistSession:false}});
  const runId=randomUUID();const email=`phase13-${runId}@tindio.test`;const password=`Tindio-Phase13-${randomUUID()}!`;
  const created=await admin.auth.admin.createUser({email,password,email_confirm:true,user_metadata:{full_name:"Phase 13 Owner"}});if(created.error)fail(created.error.message);
  await Promise.all([signIn(a,email,password),signIn(b,email,password)]);
  const raw=await rpc(a,"bootstrap_organization",{organization_name:`Phase 13 ${runId.slice(0,8)}`,register_name:"Register",store_name:"Store"});const boot=Array.isArray(raw)?raw[0]:raw;
  const organizationId=boot.organization_id,storeId=boot.store_id;
  const productId=await rpc(a,"create_catalog_product_v3",{target_allow_fractional_quantity:false,target_barcode:`P13${runId.replaceAll("-","").slice(0,10)}`,target_category_id:null,target_composite_inventory_mode:"made_to_order",target_cost_minor:500,target_description:"Concurrency fixture",target_image_url:"",target_is_variable_price:false,target_name:"Phase 13 Item",target_organization_id:organizationId,target_price_minor:1000,target_product_type:"simple",target_sku:`P13-${runId.slice(0,8)}`,target_store_ids:[storeId],target_track_inventory:true,target_unit:"each",target_variants:[]});
  const beforeMovements=number(`select count(*) from public.inventory_movements where organization_id=${sqlUuid(organizationId)}`);

  console.log("Scenario A: same position, same payload");
  await Promise.all([rpc(a,"upsert_inventory_replenishment_rule_v2",ruleArgs(organizationId,storeId,productId,2,8)),rpc(b,"upsert_inventory_replenishment_rule_v2",ruleArgs(organizationId,storeId,productId,2,8))]);
  assert(number(`select count(*) from public.inventory_replenishment_rules where organization_id=${sqlUuid(organizationId)} and store_id=${sqlUuid(storeId)} and product_id=${sqlUuid(productId)} and variant_id is null`)===1,"Same-payload saves duplicated the rule.");

  console.log("Scenario B: same position, different valid payloads");
  await Promise.all([rpc(a,"upsert_inventory_replenishment_rule_v2",ruleArgs(organizationId,storeId,productId,3,9)),rpc(b,"upsert_inventory_replenishment_rule_v2",ruleArgs(organizationId,storeId,productId,4,12))]);
  const finalRule=json(`select json_build_object('reorder',reorder_point,'target',target_stock)::text from public.inventory_replenishment_rules where organization_id=${sqlUuid(organizationId)} and store_id=${sqlUuid(storeId)} and product_id=${sqlUuid(productId)} and variant_id is null`);
  assert((Number(finalRule.reorder)===3&&Number(finalRule.target)===9)||(Number(finalRule.reorder)===4&&Number(finalRule.target)===12),"Concurrent saves produced a torn payload.");

  console.log("Scenario C: legacy low-stock write race");
  fixtureSql(`alter table public.product_store_settings disable trigger product_store_settings_guard_legacy_low_stock_level; update public.product_store_settings set low_stock_level=5 where organization_id=${sqlUuid(organizationId)} and store_id=${sqlUuid(storeId)} and product_id=${sqlUuid(productId)}; alter table public.product_store_settings enable trigger product_store_settings_guard_legacy_low_stock_level;`);
  const rejected=await Promise.all([a.from("product_store_settings").update({low_stock_level:6}).eq("organization_id",organizationId).eq("store_id",storeId).eq("product_id",productId),b.from("product_store_settings").update({low_stock_level:7}).eq("organization_id",organizationId).eq("store_id",storeId).eq("product_id",productId)]);
  assert(rejected.every((result)=>result.error),"A legacy threshold mutation was accepted.");
  assert(number(`select low_stock_level from public.product_store_settings where organization_id=${sqlUuid(organizationId)} and store_id=${sqlUuid(storeId)} and product_id=${sqlUuid(productId)}`)===5,"Historical legacy threshold changed.");
  assert(number(`select count(*) from public.inventory_movements where organization_id=${sqlUuid(organizationId)}`)===beforeMovements,"Settings concurrency created stock movements.");
  const levels=json("select coalesce(jsonb_agg(to_jsonb(x)),'[]')::text from (select organization_id,store_id,product_id,variant_id,quantity from public.inventory_levels) x");
  const movements=json("select coalesce(jsonb_agg(to_jsonb(x) order by created_at,id),'[]')::text from (select id,organization_id,store_id,product_id,variant_id,quantity_before,quantity_delta,quantity_after,created_at,operation_id,source_id,source_type from public.inventory_movements) x");
  const reconciliation=reconcileInventoryState({levels,movements});assert(reconciliation.ok,`Settings concurrency left ${reconciliation.anomalyCount} reconciliation anomalies.`);
  console.log(JSON.stringify({ruleRows:1,finalRule,legacyWritesRejected:2,stockMovementsCreated:0,reconciliationAnomalies:reconciliation.anomalyCount},null,2));
  console.log("REPLENISHMENT SETTINGS CONCURRENCY EVIDENCE: PASS");
}
try{await main();}catch(error){console.error(error instanceof Error?error.message:"Phase 13 concurrency failed.");process.exit(1);}
