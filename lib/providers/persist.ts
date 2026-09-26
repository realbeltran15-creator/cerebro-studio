import type { GeneratedAsset,ProviderContext } from './types'
import { createServerSupabaseClient } from '@/lib/supabase/server'

const extFor=(mime:string)=>mime.includes('png')?'png':mime.includes('jpeg')||mime.includes('jpg')?'jpg':mime.includes('webp')?'webp':mime.includes('mpeg')?'mp3':mime.includes('wav')?'wav':mime.includes('video')?'mp4':'bin'

async function materialize(asset:GeneratedAsset){
 if(asset.uri.startsWith('data:')){const match=asset.uri.match(/^data:([^;]+);base64,(.+)$/);if(!match)throw new Error('Unsupported generated data URI.');return{bytes:Buffer.from(match[2],'base64'),mime:match[1]}}
 const url=new URL(asset.uri);if(url.protocol!=='https:')throw new Error('Generated asset URL must use HTTPS.');const response=await fetch(url,{redirect:'error'});if(!response.ok)throw new Error('Could not retrieve generated asset.');const declared=response.headers.get('content-type')?.split(';')[0];return{bytes:Buffer.from(await response.arrayBuffer()),mime:declared||asset.mimeType}
}

export async function persistGeneratedAsset(context:ProviderContext,kind:'image'|'thumbnail'|'video'|'voice'|'render',asset:GeneratedAsset){
 const supabase=await createServerSupabaseClient();const{data:{user}}=await supabase.auth.getUser();if(!user||user.id!==context.ownerId)throw new Error('Unauthorized provider asset persistence.')
 const{bytes,mime}=await materialize(asset);const maxBytes=kind==='image'||kind==='thumbnail'?25*1024*1024:250*1024*1024;if(bytes.byteLength>maxBytes)throw new Error('Generated asset exceeds storage size limit.')
 const storagePath=`${user.id}/${context.projectId}/${context.requestId}.${extFor(mime)}`
 const{error:uploadError}=await supabase.storage.from('generated-assets').upload(storagePath,bytes,{contentType:mime,upsert:false});if(uploadError)throw new Error(`Could not store generated asset: ${uploadError.message}`)
 const{data,error}=await supabase.from('assets').insert({owner_id:user.id,project_id:context.projectId,asset_type:kind,storage_path:storagePath,source_provider:asset.provider,provenance:{externalId:asset.externalId??null,mimeType:mime,requestId:context.requestId,...(asset.metadata??{})}}).select('id,owner_id,project_id,asset_type,storage_path,source_provider,provenance,created_at').single()
 if(error){await supabase.storage.from('generated-assets').remove([storagePath]);throw new Error(`Could not persist generated asset: ${error.message}`)}return data
}
