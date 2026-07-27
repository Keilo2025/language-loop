const plans = [
  { title: 'Solo', description: 'For one engineer watching one pipeline.' },
  { title: 'Team', description: 'For everyone who gets paged.' },
];

export default function Pricing() {
  return (
    <div>
      <h1>Pricing</h1>
      {plans.map((plan) => (
        <article key={plan.title}>
          <h3>{plan.title}</h3>
          <p>{plan.description}</p>
        </article>
      ))}
    </div>
  );
}
