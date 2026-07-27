export function Hero() {
  const size = 'lg';
  return (
    <header className="flex flex-col gap-4">
      <h1>Find out your deploy broke in 4 minutes</h1>
      <input placeholder="you@example.com" type="email" aria-label="Your work email address" />
      <button data-size={size}>Start my free audit</button>
      <img src="/hero.png" alt="A dashboard showing four failing deploys" />
      <p>You have {count} builds waiting.</p>
    </header>
  );
}
