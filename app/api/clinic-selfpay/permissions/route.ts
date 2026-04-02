import { NextResponse } from 'next/server';
import { getClinicSelfpayAccess, getCurrentUserId } from '../_lib';

export async function GET() {
  try {
    const userId = await getCurrentUserId();
    if (!userId) {
      return NextResponse.json({ success: false, error: '未登入' }, { status: 401 });
    }

    const access = await getClinicSelfpayAccess(userId);
    return NextResponse.json({ success: true, data: access });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
