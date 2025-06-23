// File: app/api/save-svg/route.ts

// ① 이 라우트만 Node.js 런타임에서 실행되도록 설정
export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';

export async function POST(request: Request) {
  const body = await request.json();
  if (typeof body.svg !== 'string') {
    return NextResponse.json(
      { success: false, error: 'Invalid payload' },
      { status: 400 }
    );
  }

  const svg = body.svg;
  const dir  = path.join(process.cwd(), 'public', 'saved-svgs');
  const name = `pitch-${Date.now()}.svg`;
  const file = path.join(dir, name);

  try {
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(file, svg, 'utf-8');
    return NextResponse.json(
      { success: true, file: `/saved-svgs/${name}` },
      { status: 200 }
    );
  } catch (err) {
    console.error(err);
    return NextResponse.json(
      { success: false },
      { status: 500 }
    );
  }
}
