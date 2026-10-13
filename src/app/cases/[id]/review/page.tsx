import { redirect } from 'next/navigation';
import { requireReviewerRole } from '@/lib/demoSession';
export default async function ReviewPage({params,searchParams}:{params:Promise<{id:string}>;searchParams:Promise<{run?:string}>}) {
 await requireReviewerRole(); const {id}=await params; const {run}=await searchParams;
 redirect('/cases/'+encodeURIComponent(id)+'?section=assessment'+(run?'&run='+encodeURIComponent(run):''));
}
