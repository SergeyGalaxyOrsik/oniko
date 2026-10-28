import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

const PROSE = [
  'text-[0.925rem] leading-7 text-foreground/90',
  '[&_p]:my-2 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0',
  '[&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-5 [&_li]:my-0.5',
  '[&_strong]:font-semibold [&_strong]:text-foreground',
  '[&_a]:text-foreground [&_a]:underline [&_a]:underline-offset-2',
  '[&_h1]:mt-4 [&_h1]:text-lg [&_h1]:font-semibold [&_h2]:mt-4 [&_h2]:text-base [&_h2]:font-semibold [&_h3]:mt-3 [&_h3]:font-semibold',
  '[&_:not(pre)>code]:rounded [&_:not(pre)>code]:bg-muted [&_:not(pre)>code]:px-1.5 [&_:not(pre)>code]:py-0.5 [&_:not(pre)>code]:font-mono [&_:not(pre)>code]:text-[0.8rem]',
  '[&_pre]:my-3 [&_pre]:overflow-x-auto [&_pre]:rounded-xl [&_pre]:border [&_pre]:border-border [&_pre]:bg-card [&_pre]:p-3 [&_pre]:font-mono [&_pre]:text-xs [&_pre]:leading-5',
  '[&_table]:my-3 [&_table]:w-full [&_table]:text-sm [&_th]:border-b [&_th]:border-border [&_th]:py-1 [&_th]:text-left [&_td]:border-b [&_td]:border-border/50 [&_td]:py-1',
  '[&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground',
].join(' ')

export function Markdown({ text }: { text: string }) {
  return (
    <div className={PROSE}>
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>
    </div>
  )
}
