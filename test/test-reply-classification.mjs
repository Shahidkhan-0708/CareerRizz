import { classifyReply } from '../src/integrations/ai/classifier.js';

async function run() {
  const samples = [
    {
      label: 'Speaker Acceptance',
      text: 'Thank you for the invitation! I would be delighted to attend as a Keynote Speaker for the AI Innovation Summit. Could you share the schedule?',
    },
    {
      label: 'Out of Office',
      text: 'I am currently on sabbatical and out of office until November 15th, 2026.',
    },
    {
      label: 'Polite Decline',
      text: 'Sorry, due to prior conference commitments I will not be able to participate this time. Please keep me in mind for future editions.',
    },
    {
      label: 'Clarification Question',
      text: 'This sounds interesting. Will the sessions be conducted offline on campus or will there be an option for virtual delivery?',
    }
  ];

  console.log('==============================================');
  console.log('Testing Reply Intelligence & AI Categorization');
  console.log('==============================================');

  for (const sample of samples) {
    console.log(`\n▶ [${sample.label}]`);
    console.log(`Reply: "${sample.text}"`);
    const result = await classifyReply(sample.text);
    console.log(`Category:       [${result.category}]`);
    console.log(`Sentiment:      ${result.sentiment}`);
    console.log(`Summary:        ${result.summary}`);
    console.log(`Suggested Next: ${result.nextAction}`);
    console.log(`Human Review:   ${result.requiresHumanReview}`);
  }
}

run();
