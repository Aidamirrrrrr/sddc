import { parseReviewDecision, type ReviewDecision } from "./approval";
import { ask } from "./input";

export async function askReviewDecision(label: string): Promise<ReviewDecision> {
  while (true) {
    const decision = parseReviewDecision(await ask(label));
    if (decision !== null) return decision;
    console.log("Enter 'a' to accept or 'r' to revise.");
  }
}

export async function askRequired(label: string): Promise<string> {
  while (true) {
    const answer = await ask(label);
    if (answer.length > 0) return answer;
    console.log("An answer is required.");
  }
}
