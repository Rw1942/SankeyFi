interface StatusFeedProps {
  entries: string[];
}

export function StatusFeed({ entries }: StatusFeedProps) {
  if (!entries.length) {
    return null;
  }

  return (
    <footer className="status-feed">
      {entries.map((entry, index) => (
        <p key={`${index}-${entry}`} className={`status ${index === entries.length - 1 ? "status-latest" : ""}`}>
          {entry}
        </p>
      ))}
    </footer>
  );
}
