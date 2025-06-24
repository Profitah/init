import { NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';

export async function POST(request: Request) {
  const defPts = await request.json();
  const out = path.join(process.cwd(), 'public', 'pitch.json');
  await fs.writeFile(out, JSON.stringify(defPts, null, 2), 'utf-8');
  return NextResponse.json({ success: true });
}
