"use client";

import Markdown from "react-markdown";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";

/**
 * Cuerpo de mensaje con formato: **negrita**, _cursiva_, ~~tachado~~,
 * `código`, bloques ```código```, citas, listas y enlaces.
 * Sin HTML crudo (react-markdown lo escapa) y sin imágenes remotas
 * ni títulos gigantes, que en un chat solo dan sustos.
 */
export default function MessageContent({ content }: { content: string }) {
  return (
    <div className="text-sm break-words text-gray-800">
      <Markdown
        remarkPlugins={[remarkGfm, remarkBreaks]}
        disallowedElements={["img", "h1", "h2", "h3", "h4", "h5", "h6"]}
        unwrapDisallowed
        components={{
          a: ({ href, children }) => (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="text-violet-700 underline hover:text-violet-900"
            >
              {children}
            </a>
          ),
          p: ({ children }) => <p className="my-0.5">{children}</p>,
          strong: ({ children }) => <strong className="font-bold">{children}</strong>,
          blockquote: ({ children }) => (
            <blockquote className="my-1 border-l-4 border-gray-300 pl-3 text-gray-600">
              {children}
            </blockquote>
          ),
          ul: ({ children }) => <ul className="my-1 list-disc pl-5">{children}</ul>,
          ol: ({ children }) => <ol className="my-1 list-decimal pl-5">{children}</ol>,
          pre: ({ children }) => (
            <pre className="my-1.5 overflow-x-auto rounded-lg border border-gray-200 bg-gray-50 p-3 text-xs leading-relaxed">
              {children}
            </pre>
          ),
          code: ({ children, className }) => {
            // Con className (language-*) viene de un bloque ```; sin él, es inline.
            if (className) {
              return <code className={`font-mono ${className}`}>{children}</code>;
            }
            return (
              <code className="rounded border border-gray-200 bg-gray-100 px-1 py-0.5 font-mono text-[0.85em] text-pink-700">
                {children}
              </code>
            );
          },
          table: ({ children }) => (
            <table className="my-1.5 border-collapse text-xs">{children}</table>
          ),
          th: ({ children }) => (
            <th className="border border-gray-300 bg-gray-50 px-2 py-1 text-left">
              {children}
            </th>
          ),
          td: ({ children }) => (
            <td className="border border-gray-300 px-2 py-1">{children}</td>
          ),
        }}
      >
        {content}
      </Markdown>
    </div>
  );
}
