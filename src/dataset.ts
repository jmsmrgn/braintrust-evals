// ---------------------------------------------------------------------------
// Test case dataset — 20 realistic customer support tickets
//
// Covers billing, technical, account access, feature requests, and
// angry-customer scenarios. Designed to stress-test the support pipeline
// across a range of tones and complexity levels.
// ---------------------------------------------------------------------------

export type ExpectedTone = "empathetic" | "technical" | "apologetic";
export type Complexity = "simple" | "moderate" | "complex";

export interface TestCase {
  id: string;
  input: string;
  expected_topics: string[];
  expected_tone: ExpectedTone;
  complexity: Complexity;
}

export const dataset: TestCase[] = [
  // ---- Billing disputes ------------------------------------------------

  {
    id: "billing-001",
    input:
      "I was charged twice for my subscription this month. I see two identical charges of $49 on my credit card statement from the 3rd and the 4th. I need one of them refunded immediately.",
    expected_topics: [
      "acknowledge duplicate charge",
      "refund process",
      "timeline for resolution",
    ],
    expected_tone: "apologetic",
    complexity: "simple",
  },
  {
    id: "billing-002",
    input:
      "You upgraded my plan without my consent. I was on the Starter plan at $19/month and now I'm being billed $79/month for Professional. I never agreed to this. I want a full refund for the difference for the last 3 months and to be moved back to Starter.",
    expected_topics: [
      "unauthorized upgrade",
      "refund for overcharge",
      "plan downgrade",
      "investigation",
    ],
    expected_tone: "apologetic",
    complexity: "complex",
  },
  {
    id: "billing-003",
    input:
      "My annual subscription renews next week and I'd like to cancel before it does. I don't want to be charged for another year. What do I need to do?",
    expected_topics: [
      "cancellation process",
      "renewal deadline",
      "confirmation of cancellation",
    ],
    expected_tone: "empathetic",
    complexity: "simple",
  },
  {
    id: "billing-004",
    input:
      "I have a promo code from your webinar — WEBINAR30 — but the system says it's invalid. I've tried three times. I specifically signed up because of this discount.",
    expected_topics: [
      "promo code troubleshooting",
      "manual discount application",
      "next steps",
    ],
    expected_tone: "empathetic",
    complexity: "moderate",
  },

  // ---- Technical troubleshooting ---------------------------------------

  {
    id: "tech-001",
    input:
      "Your API keeps returning 429 errors even though I'm well under my rate limit. I'm on the Growth plan which says 1000 req/min but I'm only making about 50. This has been happening for 2 hours and it's blocking our production release.",
    expected_topics: [
      "rate limit investigation",
      "escalation path",
      "immediate workaround",
      "production urgency",
    ],
    expected_tone: "technical",
    complexity: "complex",
  },
  {
    id: "tech-002",
    input:
      "The Chrome extension stopped working after your update yesterday. I click the icon and nothing happens. I've tried reinstalling it twice.",
    expected_topics: [
      "extension troubleshooting steps",
      "known issue acknowledgment",
      "alternative access method",
    ],
    expected_tone: "technical",
    complexity: "moderate",
  },
  {
    id: "tech-003",
    input:
      "How do I export my data? I need all of my project files in a CSV or JSON format. I've looked everywhere in the settings and can't find it.",
    expected_topics: [
      "data export location",
      "supported formats",
      "step-by-step instructions",
    ],
    expected_tone: "technical",
    complexity: "simple",
  },
  {
    id: "tech-004",
    input:
      "Our SSO integration with Okta broke this morning. Users are getting 'SAML assertion invalid' errors when trying to log in. We have 200 employees who can't access the platform.",
    expected_topics: [
      "SSO/SAML troubleshooting",
      "escalation to engineering",
      "temporary workaround",
      "urgency acknowledgment",
    ],
    expected_tone: "technical",
    complexity: "complex",
  },
  {
    id: "tech-005",
    input:
      "I'm getting a blank white screen when I try to open my dashboard. I've cleared my cache and tried different browsers. My colleague can see the dashboard fine on their account.",
    expected_topics: [
      "account-specific issue",
      "diagnostic steps",
      "escalation if needed",
    ],
    expected_tone: "empathetic",
    complexity: "moderate",
  },

  // ---- Account access issues -------------------------------------------

  {
    id: "access-001",
    input:
      "I can't log into my account. I reset my password three times but the reset emails aren't arriving. I've checked my spam folder.",
    expected_topics: [
      "email deliverability troubleshooting",
      "alternative verification",
      "manual account recovery",
    ],
    expected_tone: "empathetic",
    complexity: "moderate",
  },
  {
    id: "access-002",
    input:
      "My account got locked after too many failed login attempts. I'm sure I have the right password now. How do I unlock it?",
    expected_topics: [
      "account unlock process",
      "security explanation",
      "prevention tips",
    ],
    expected_tone: "empathetic",
    complexity: "simple",
  },
  {
    id: "access-003",
    input:
      "An employee who left our company two months ago still has admin access to our workspace. I'm the owner and I can't figure out how to remove them. Their email is no longer active.",
    expected_topics: [
      "admin role removal",
      "deactivating user with inactive email",
      "security best practices",
    ],
    expected_tone: "technical",
    complexity: "moderate",
  },
  {
    id: "access-004",
    input:
      "I think my account has been compromised. There are sessions from IP addresses in countries I've never been to and projects I didn't create. What should I do right now?",
    expected_topics: [
      "immediate account security steps",
      "session termination",
      "password and 2FA",
      "security review",
    ],
    expected_tone: "empathetic",
    complexity: "complex",
  },

  // ---- Feature requests ------------------------------------------------

  {
    id: "feature-001",
    input:
      "Is there a way to set up automated weekly reports that get emailed to my team? I can't find this option anywhere.",
    expected_topics: [
      "current capability or limitation",
      "workaround if unavailable",
      "roadmap or feedback channel",
    ],
    expected_tone: "empathetic",
    complexity: "simple",
  },
  {
    id: "feature-002",
    input:
      "We really need a bulk import feature for contacts. Right now we're manually adding them one by one and we have 500 to add. This is a huge time sink.",
    expected_topics: [
      "current import options",
      "workaround or manual assistance",
      "feature request acknowledgment",
    ],
    expected_tone: "empathetic",
    complexity: "moderate",
  },
  {
    id: "feature-003",
    input:
      "Does your API support webhooks? I need to trigger actions in our internal system whenever a record is updated.",
    expected_topics: [
      "webhook availability",
      "documentation or setup instructions",
      "supported events",
    ],
    expected_tone: "technical",
    complexity: "moderate",
  },

  // ---- Angry / frustrated customers ------------------------------------

  {
    id: "angry-001",
    input:
      "This is the THIRD time I've contacted support about the same issue and nobody has resolved it. I've been waiting a week. This is completely unacceptable. If this isn't fixed today I'm canceling.",
    expected_topics: [
      "acknowledge repeated contact",
      "apology for failure",
      "immediate escalation",
      "retention effort",
    ],
    expected_tone: "apologetic",
    complexity: "complex",
  },
  {
    id: "angry-002",
    input:
      "Your platform went down for 4 hours yesterday during our biggest client presentation. We looked completely unprofessional. I want to know what happened and what compensation you're offering.",
    expected_topics: [
      "outage acknowledgment",
      "incident explanation",
      "compensation or SLA credit",
      "prevention measures",
    ],
    expected_tone: "apologetic",
    complexity: "complex",
  },
  {
    id: "angry-003",
    input:
      "I specifically asked your sales rep if the platform could do X before I signed up. They said yes. Now I find out it can't. I feel like I was lied to. This is fraud.",
    expected_topics: [
      "acknowledge the frustration",
      "clarify capability",
      "offer path to resolution or exit",
      "avoid defensive tone",
    ],
    expected_tone: "apologetic",
    complexity: "complex",
  },
  {
    id: "angry-004",
    input:
      "Why does it take 3 days to hear back from support? I pay for Business tier which says 'priority support' but I'm getting the same slow responses as everyone else. What exactly am I paying for?",
    expected_topics: [
      "SLA acknowledgment",
      "apology for delay",
      "priority support clarification",
      "immediate attention to current issue",
    ],
    expected_tone: "apologetic",
    complexity: "moderate",
  },
];
