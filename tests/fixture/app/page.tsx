import { Hero } from '../components/Hero';

export default function HomePage() {
  return (
    <main className="mx-auto max-w-4xl px-6">
      <Hero />
      <section>
        <h2>Everything in one place</h2>
        <p>Watch every deploy across your pipeline and know the moment one fails.</p>
        <button type="submit">Get started free</button>
      </section>
    </main>
  );
}
