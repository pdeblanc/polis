import type { PropsWithChildren, ReactNode } from 'react';
import { Link } from 'react-router-dom';

type PageProps = PropsWithChildren<{
  className?: string;
  documentTitle?: string;
  eyebrow?: string;
  title: string;
  introduction: ReactNode;
}>;

export function Page({
  children,
  className,
  documentTitle,
  eyebrow,
  introduction,
  title,
}: PageProps) {
  return (
    <main className={['page-shell', className].filter(Boolean).join(' ')}>
      {documentTitle === undefined ? null : <title>{documentTitle}</title>}
      <header className="page-header">
        {eyebrow === undefined ? null : <p className="eyebrow">{eyebrow}</p>}
        <h1>{title}</h1>
        <div className="introduction">{introduction}</div>
      </header>
      {children}
    </main>
  );
}

export function BackLink() {
  return (
    <Link className="back-link" to="/">
      ← All experiments
    </Link>
  );
}
