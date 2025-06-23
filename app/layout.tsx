export const metadata = {
  title: 'Voice Counter Demo',
  description: 'Mic permission & hydration-safe layout',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    /* Dark Reader 등 확장이 삽입하는 data- 속성 차이를 무시 */
    <html lang="en" suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
