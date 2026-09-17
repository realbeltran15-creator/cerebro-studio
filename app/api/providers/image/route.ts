import { NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { OpenAIImageProvider } from '@/lib/providers/openai-image'
import { ProviderRegistry } from '@/lib/providers/registry'
import { persistGeneratedAsset } from '@/lib/providers/persist'

export const dynamic = 'force-dynamic'

const styles={
 cinematic:'cinematic film still, sophisticated composition, dramatic natural lighting, realistic materials, rich depth, premium color grading',
 photorealistic:'high-end photorealistic photography, physically plausible light, natural textures, fine detail, professional camera aesthetic',
 documentary:'authentic documentary photography, natural available light, candid realism, grounded details, editorial composition',
 illustration:'premium editorial digital illustration, refined shapes, expressive composition, detailed artistic finish',
 '3d':'high-end 3D render, detailed materials, global illumination, cinematic composition, polished production quality',
 anime:'original anime-inspired illustration, expressive composition, detailed environment, polished animation-film quality',
 vintage:'vintage analog photography aesthetic, subtle film grain, period-appropriate color response, tactile texture',
 minimal:'premium minimalist visual design, strong negative space, clean geometry, restrained composition',
 fantasy:'original cinematic fantasy concept art, atmospheric depth, intricate worldbuilding, dramatic lighting, premium detail',
 surreal:'surreal fine-art image, imaginative visual metaphor, coherent dreamlike composition, sophisticated lighting',
} as const

type Style=keyof typeof styles

export async function POST(request: Request) {
 const supabase=await createServerSupabaseClient();const{data:{user}}=await supabase.auth.getUser();if(!user)return NextResponse.json({error:'Unauthorized'},{status:401})
 const body=await request.json().catch(()=>null) as {projectId?:string;prompt?:string;style?:Style}|null
 const projectId=body?.projectId?.trim(),prompt=body?.prompt?.trim();if(!projectId||!prompt)return NextResponse.json({error:'projectId and prompt are required'},{status:400})
 const{data:project}=await supabase.from('projects').select('id').eq('id',projectId).eq('owner_id',user.id).maybeSingle();if(!project)return NextResponse.json({error:'Project not found'},{status:404})
 const style:Style=body?.style&&body.style in styles?body.style:'cinematic';const requestId=crypto.randomUUID();const context={ownerId:user.id,projectId,requestId}
 const enhancedPrompt=`${prompt}\n\nVisual direction: ${styles[style]}. Create an original, coherent, professional-quality image with strong subject clarity, intentional composition, accurate anatomy and perspective where applicable, clean details, and no accidental text, logos or watermarks.`
 try{const registry=new ProviderRegistry<OpenAIImageProvider>().register(new OpenAIImageProvider());const provider=await registry.resolve('openai-image');const generated=await provider.generateImage(context,enhancedPrompt);generated.metadata={...(generated.metadata??{}),style,originalPrompt:prompt};const asset=await persistGeneratedAsset(context,'image',generated);return NextResponse.json({requestId,style,asset},{status:201})}catch(error){return NextResponse.json({error:error instanceof Error?error.message:'Image generation failed.',requestId},{status:503})}
}
