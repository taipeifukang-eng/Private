import Link from 'next/link';
import { AlertCircle, ArrowLeft } from 'lucide-react';

type ModuleUnavailablePageProps = {
  title: string;
};

export default function ModuleUnavailablePage({ title }: ModuleUnavailablePageProps) {
  return (
    <div className="min-h-[calc(100vh-4rem)] bg-slate-50 p-4 lg:p-6">
      <div className="mx-auto max-w-3xl rounded-lg border border-slate-200 bg-white p-10 text-center">
        <AlertCircle className="mx-auto h-12 w-12 text-slate-400" />
        <h1 className="mt-4 text-2xl font-bold text-slate-950">{title}</h1>
        <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-slate-500">
          此功能尚未在目前測試環境開放。
        </p>
        <Link
          href="/general-affairs"
          className="mt-5 inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50"
        >
          <ArrowLeft size={16} />
          回到總務服務中心
        </Link>
      </div>
    </div>
  );
}
