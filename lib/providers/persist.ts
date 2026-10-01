import type { GeneratedAsset,ProviderContext } from './types'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { generationProvenance } from './provenance'

const extFor=(mime:string)=>mime.includes('png')?'png':mime.includes('jpeg')||mime.includes('jpg')?'jpg':mime.includes('webp')?'webp':mime.includes('mpeg')?'mp3':mime.includes('wav')?'wav':mime.includes('video')?'mp4':'bin'

async function materialize(asset:GeneratedAsset){
 if(asset.uri.startsWith('data:')){const match=asset.uri.match(/^data:([^;]+);base64,(.+)$/);if(!match)throw new Error('Unsupported generated data URI.');return{bytes:Buffer.from(match[2],'base64'),mime:match[1]}}
 const url=new URL(asset.uri);if(url.protocol!=='https:')throw new Error('Generated asset URL must use HTTPS.');const response=await fetch(url,{redirect:'error'});if(!response.ok)throw new Error('Could not retrieve generated asset.');const declared=response.headers.get('content-type')?.split(';')[0];return{bytes:Buffer.from(await response.arrayBuffer()),mime:declared||asset.mimeType}
}

export async function persistGeneratedAsset(context:ProviderContext,kind:'image'|'thumbnail'|'video'|'voice'|'render'|'sfx'|'music',asset:GeneratedAsset){
 const supabase=await createServerSupabaseClient();const{data:{user}}=await supabase.auth.getUser();if(!user||user.id!==context.ownerId)throw new Error('Unauthorized provider asset persistence.')
 const{bytes,mime}=await materialize(asset);const maxBytes=kind==='image'||kind==='thumbnail'?25*1024*1024:250*1024*1024;if(bytes.byteLength>maxBytes)throw new Error('Generated asset exceeds storage size limit.')
 const storagePath=`${user.id}/${context.projectId}/${context.requestId}.${extFor(mime)}`
 const{error:uploadError}=await supabase.storage.from('generated-assets').upload(storagePath,bytes,{contentType:mime,upsert:false});if(uploadError)throw new Error(`Could not store generated asset: ${uploadError.message}`)
 // assets.asset_type has no 'render' value: renders are stored as videos tagged with their purpose.
 const assetType=kind==='render'?'video':kind
 const{data,error}=await supabase.from('assets').insert({owner_id:user.id,project_id:context.projectId,asset_type:assetType,storage_path:storagePath,source_provider:asset.provider,license_status:'generated',provenance:generationProvenance({provider:asset.provider,requestId:context.requestId,projectId:context.projectId,mimeType:mime,externalId:asset.externalId,purpose:kind==='render'?'render':undefined,metadata:asset.metadata})}).select('id,owner_id,project_id,asset_type,storage_path,source_provider,provenance,created_at').single()
 if(error){await supabase.storage.from('generated-assets').remove([storagePath]);throw new Error(`Could not persist generated asset: ${error.message}`)}return data
}

/** Stores a file imported from a free media bank, keeping license, author and source. Idempotent per (source, id). */
export async function persistImportedAsset(input: {
  ownerId: string; projectId: string; kind: 'image' | 'video' | 'music' | 'sfx'; source: string; externalId: string
  downloadUrl: string; mimeType: string; licenseStatus: 'public_domain' | 'licensed' | 'restricted'; sourceUrl: string
  provenance: Record<string, unknown>
}) {
  const supabase=await createServerSupabaseClient();const{data:{user}}=await supabase.auth.getUser();if(!user||user.id!==input.ownerId)throw new Error('Unauthorized import.')
  const external=`${input.source}:${input.externalId}`
  const{data:existing}=await supabase.from('assets').select('id,owner_id,project_id,asset_type,storage_path,source_provider,source_url,license_status,provenance,created_at').eq('owner_id',user.id).eq('project_id',input.projectId).eq('provenance->>externalId',external).maybeSingle()
  if(existing)return{asset:existing,duplicate:true}
  const r=await fetch(input.downloadUrl,{redirect:'error',cache:'no-store',signal:AbortSignal.timeout(90000)});if(!r.ok)throw new Error(`No se pudo descargar el archivo (${r.status}).`)
  const bytes=Buffer.from(await r.arrayBuffer());const mime=r.headers.get('content-type')?.split(';')[0]||input.mimeType
  const max=input.kind==='image'?25*1024*1024:input.kind==='video'?150*1024*1024:50*1024*1024;if(!bytes.length||bytes.byteLength>max)throw new Error('El archivo es demasiado grande para importarlo.')
  const storagePath=`${user.id}/${input.projectId}/import-${input.source}-${input.externalId.replace(/[^A-Za-z0-9-]/g,'')}.${extFor(mime)}`
  const{error:uploadError}=await supabase.storage.from('generated-assets').upload(storagePath,bytes,{contentType:mime,upsert:false});if(uploadError)throw new Error(`No se pudo guardar el archivo: ${uploadError.message}`)
  const{data,error}=await supabase.from('assets').insert({owner_id:user.id,project_id:input.projectId,asset_type:input.kind,storage_path:storagePath,source_provider:input.source,source_url:input.sourceUrl,license_status:input.licenseStatus,provenance:{...input.provenance,externalId:external,mimeType:mime,importedAt:new Date().toISOString(),cost:{amount:0,currency:'USD',reported:true},costTier:'free'}}).select('id,owner_id,project_id,asset_type,storage_path,source_provider,source_url,license_status,provenance,created_at').single()
  if(error){await supabase.storage.from('generated-assets').remove([storagePath]);throw new Error(`No se pudo registrar el archivo: ${error.message}`)}
  return{asset:data,duplicate:false}
}
