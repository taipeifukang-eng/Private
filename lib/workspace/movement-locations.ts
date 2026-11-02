export type PlacementUnit={id:string;code:string;name:string;type:string;status:string;parent_id:string|null;sort_order?:number|null};

// Same headquarters / active leaf selection as the legacy batch form, with cycle and orphan guards.
export function movementPlacementOptions(units:PlacementUnit[]){
 const active=units.filter(u=>u.status==='active'),byId=new Map(active.map(u=>[u.id,u]));
 const parents=new Set(active.map(u=>u.parent_id).filter(Boolean)),hasHeadquarters=active.some(u=>u.type==='headquarters');
 return active.flatMap(unit=>{
  if(unit.type==='company'||parents.has(unit.id))return [];
  const path=[unit.name],visited=new Set([unit.id]);let parent=unit.parent_id,headquarters=false;
  while(parent){const ancestor=byId.get(parent);if(!ancestor||visited.has(parent))return [];visited.add(parent);path.unshift(ancestor.name);if(ancestor.type==='headquarters')headquarters=true;parent=ancestor.parent_id;}
  if(hasHeadquarters&&!headquarters)return [];
  return [{...unit,path:path.join(' / ')}];
 }).sort((a,b)=>(a.sort_order||0)-(b.sort_order||0)||a.code.localeCompare(b.code)||a.id.localeCompare(b.id));
}
