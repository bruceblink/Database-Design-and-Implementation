import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Database Design and Implementation Second Edition 中文翻译',
  description: '数据库的设计与实现中文翻译版本',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="zh-CN" className="scroll-smooth">
      <body className="font-sans antialiased bg-gradient-to-b from-white to-gray-50 dark:from-gray-900 dark:to-gray-800 flex flex-col min-h-screen">
        <div className="flex-1">
          {children}
        </div>
        <footer className="mt-auto py-4 border-t border-gray-200/10">
          <div className="container mx-auto px-4 text-center text-sm text-gray-600 dark:text-gray-400">
            基于 Edward Sciore 的《Database Design and Implementation Second Edition》英文原版翻译
          </div>
        </footer>
      </body>
    </html>
  )
}