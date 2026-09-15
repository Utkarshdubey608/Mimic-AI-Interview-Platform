import type { McqQuestion } from '@shared/types'

/**
 * Default assessment templates — a starting point, not a finished paper.
 *
 * The Google Docs comparison the request was made against is the right one: a
 * gallery of ready-made starting points a recruiter can open and immediately
 * begin editing, rather than a blank page or a résumé of buttons to press
 * first. Every question here is real and answerable, not a placeholder —
 * picking a template must hand back something a recruiter could send as-is if
 * they chose to, even though almost nobody will without reviewing it first.
 *
 * Kept deliberately small and hand-written rather than AI-generated at build
 * time: a template is meant to be a stable, predictable starting shape a
 * recruiter can trust sight-unseen, which is the opposite of what a model
 * call would give on every page load.
 */

let n = 0
const oid = () => `t${n++}`
const opt = (text: string) => ({ id: oid(), text })

function q(
  text: string,
  options: string[],
  correctIndex: number,
  topic: string,
): McqQuestion {
  const built = options.map(opt)
  return {
    id: crypto.randomUUID(),
    text,
    type: 'single',
    options: built,
    correctOptionIds: [built[correctIndex].id],
    topic,
  }
}

export interface McqTemplate {
  id: string
  role: string
  blurb: string
  questions: McqQuestion[]
}

export const MCQ_TEMPLATES: McqTemplate[] = [
  {
    id: 'sde',
    role: 'Software Engineer',
    blurb: 'Core CS fundamentals — complexity, data structures, and everyday debugging.',
    questions: [
      q('What is the time complexity of binary search on a sorted array of n elements?',
        ['O(n)', 'O(log n)', 'O(n log n)', 'O(1)'], 1, 'Algorithms'),
      q('Which data structure is best suited for implementing a LIFO (last-in, first-out) order?',
        ['Queue', 'Stack', 'Linked list', 'Hash map'], 1, 'Data structures'),
      q('In a REST API, which HTTP method is idempotent and used to fully replace a resource?',
        ['POST', 'PATCH', 'PUT', 'GET'], 2, 'Web/APIs'),
      q('What does SQL "JOIN" primarily do?',
        ['Deletes duplicate rows', 'Combines rows from two or more tables based on a related column', 'Sorts a table', 'Creates an index'], 1, 'Databases'),
      q('A function calls itself to solve smaller instances of the same problem. This is called:',
        ['Iteration', 'Polymorphism', 'Recursion', 'Memoization'], 2, 'Programming basics'),
    ],
  },
  {
    id: 'data-analyst',
    role: 'Data Analyst',
    blurb: 'Statistics, SQL, and the everyday judgment calls of reading data honestly.',
    questions: [
      q('Which measure of central tendency is most affected by extreme outliers?',
        ['Median', 'Mode', 'Mean', 'Range'], 2, 'Statistics'),
      q('In SQL, which clause is used to filter groups AFTER a GROUP BY, not individual rows?',
        ['WHERE', 'HAVING', 'ORDER BY', 'LIMIT'], 1, 'SQL'),
      q('A correlation between two variables, on its own, is evidence of:',
        ['Causation', 'An association, not necessarily causation', 'A data entry error', 'Nothing at all'], 1, 'Statistics'),
      q('Which chart type is generally best for showing a trend over time?',
        ['Pie chart', 'Line chart', 'Scatter plot with no axis', 'Word cloud'], 1, 'Data visualization'),
      q('What does "normalizing" a dataset usually mean before analysis?',
        ['Deleting all missing values', 'Rescaling values to a common range or removing structural redundancy', 'Sorting rows alphabetically', 'Converting text to uppercase'], 1, 'Data prep'),
    ],
  },
  {
    id: 'sales',
    role: 'Sales / Business Development',
    blurb: 'Pipeline discipline, objection handling, and reading a deal honestly.',
    questions: [
      q('A prospect says "your price is too high" without further explanation. What is usually the best first response?',
        ['Immediately offer a discount', 'Ask what they are comparing the price against', 'End the call', 'Repeat the price louder'], 1, 'Objection handling'),
      q('In a typical sales pipeline, what does "qualifying" a lead mean?',
        ['Sending them a contract', 'Confirming they have the need, budget, and authority to buy', 'Adding them to a mailing list', 'Closing the deal'], 1, 'Pipeline fundamentals'),
      q('What is the main purpose of a discovery call?',
        ['To pitch the product immediately', 'To understand the prospect’s problem before proposing a solution', 'To negotiate final pricing', 'To sign the contract'], 1, 'Sales process'),
      q('A deal has gone quiet for three weeks after a strong first call. What is usually the best next step?',
        ['Wait indefinitely', 'Send one more identical follow-up email', 'Send a short, specific check-in tied to their stated problem', 'Discount the offer unprompted'], 2, 'Follow-up'),
      q('What does "churn" refer to in a sales/customer context?',
        ['New customers acquired in a period', 'Customers who stop using or paying for a product over a period', 'The total size of the sales team', 'The average deal size'], 1, 'Metrics'),
    ],
  },
  {
    id: 'hr',
    role: 'HR / People Operations',
    blurb: 'Hiring process judgment, policy basics, and day-to-day people-ops calls.',
    questions: [
      q('What is the primary purpose of a structured interview process?',
        ['To make interviews shorter', 'To reduce bias by evaluating every candidate against the same criteria', 'To avoid taking notes', 'To skip reference checks'], 1, 'Hiring'),
      q('An employee discloses a workplace harassment concern to you privately. What should you do first?',
        ['Ignore it unless it is repeated', 'Promise complete confidentiality no matter what', 'Take it seriously, document it, and follow your organization’s reporting process', 'Tell them to resolve it directly with the other person only'], 2, 'Employee relations'),
      q('What does "onboarding" primarily aim to achieve?',
        ['Filling out tax forms only', 'Helping a new hire become productive and integrated into the team', 'Extending the probation period', 'Reducing headcount'], 1, 'Onboarding'),
      q('Which of these is generally considered a legitimate factor in a hiring decision?',
        ['Candidate’s marital status', 'Candidate’s relevant skills and experience', 'Candidate’s age', 'Candidate’s nationality, where not job-relevant'], 1, 'Hiring compliance'),
      q('What is the main purpose of an exit interview?',
        ['To convince the employee to stay against their decision', 'To gather honest feedback about their experience for future improvement', 'To finalize their final paycheck', 'To assign their tasks to someone else'], 1, 'Offboarding'),
    ],
  },
  {
    id: 'marketing',
    role: 'Marketing',
    blurb: 'Funnel basics, channel judgment, and reading a campaign’s numbers.',
    questions: [
      q('What does "CTR" (click-through rate) measure?',
        ['Total ad spend', 'The percentage of people who click an ad after seeing it', 'Number of conversions', 'Average time on site'], 1, 'Metrics'),
      q('A/B testing two ad headlines is primarily used to:',
        ['Guess which one looks nicer', 'Determine, with data, which version performs better against a goal', 'Increase the ad budget automatically', 'Replace the need for analytics'], 1, 'Experimentation'),
      q('What best describes "top of funnel" marketing activity?',
        ['Closing a sale', 'Building awareness among people who don’t yet know the brand', 'Renewing an existing customer', 'Processing a refund'], 1, 'Funnel'),
      q('What does "organic reach" mean on a social platform?',
        ['Reach bought entirely through paid ads', 'Reach achieved without paid promotion', 'Reach limited to employees only', 'A guaranteed number set by the platform'], 1, 'Channels'),
      q('If a campaign has high impressions but very low CTR, what is the most likely first thing to investigate?',
        ['The company’s legal policy', 'Whether the ad creative/targeting is actually relevant to who sees it', 'The office’s WiFi speed', 'The candidate’s résumé'], 1, 'Diagnosis'),
    ],
  },
]
