// The demo documents: plain-language terms. Text is ASCII so it always fits the signature font.
import type { DocumentSource } from "../schema.ts";

type Sections = DocumentSource["sections"];

/** The Services template: staff start from this and edit. */
const SERVICES_SECTIONS: Sections = [
  {
    id: "scope",
    heading: "Scope of work",
    paragraphs: [
      "The Studio will design and build the new company website described in the project brief, including up to eight page templates, a content editor and a contact form.",
      "Work outside this scope needs a written change request from both sides before it starts.",
    ],
  },
  {
    id: "fees",
    heading: "Fees and payment",
    paragraphs: [
      "The fixed fee is 24,000 USD, invoiced in three equal parts: on signing, on design approval and on launch.",
      "Invoices are due within 30 days. Late payments accrue interest at 1% per month.",
    ],
  },
  {
    id: "timeline",
    heading: "Timeline",
    paragraphs: [
      "The Studio expects to deliver designs within four weeks of signing and launch within ten weeks, provided the Client returns feedback within five business days.",
    ],
  },
  {
    id: "ownership",
    heading: "Ownership",
    paragraphs: [
      "On full payment the Client owns the final designs and site content. The Studio keeps its general tools, templates and know-how and may reuse them for other clients.",
    ],
  },
  {
    id: "term",
    heading: "Term and ending the agreement",
    paragraphs: [
      "This agreement runs until launch and a 30-day support period after it. Either side may end it with 14 days written notice. The Client pays for work completed up to the end date.",
    ],
  },
];

export const WEBSITE_REDESIGN: DocumentSource = {
  title: "Website redesign services",
  sections: SERVICES_SECTIONS,
};

export const MUTUAL_NDA: DocumentSource = {
  title: "Mutual NDA",
  sections: [
    {
      id: "purpose",
      heading: "Purpose",
      paragraphs: [
        "The two sides want to talk about a possible working relationship and need to share confidential information to do so. This agreement sets the rules for that information.",
      ],
    },
    {
      id: "confidential",
      heading: "What is confidential",
      paragraphs: [
        "Confidential information is anything one side shares that is marked confidential or that a reasonable person would understand to be confidential, in any form.",
        "It does not include information that is public through no fault of the receiving side, was already known to it, or was developed on its own.",
      ],
    },
    {
      id: "obligations",
      heading: "How each side handles it",
      paragraphs: [
        "Each side will use the other's confidential information only to evaluate the relationship, keep it as secure as its own, and share it only with people who need it and are bound to the same duties.",
      ],
    },
    {
      id: "term",
      heading: "Term",
      paragraphs: [
        "The duties in this agreement last for two years from the date of the last signature.",
      ],
    },
  ],
};

/** The wording Jordan first asked for, which staff accepted into revision 2. */
export const NDA_OBLIGATIONS_ACCEPTED: readonly string[] = [
  "Each side will use the other's confidential information only to evaluate the relationship, keep it as secure as its own, and share it only with employees and advisers who need it and are bound to the same duties.",
  "If one side must disclose information because the law requires it, it will tell the other side first where it is allowed to.",
];

export const NDA_TERM_RECIPIENT_ASK = [
  "The duties in this agreement last for five years from the date of the last signature.",
];

export const NDA_TERM_STAFF_COUNTER = [
  "The duties in this agreement last for three years from the date of the last signature.",
  "Duties about trade secrets last for as long as the information remains a trade secret.",
];

export const NDA_TERM_RECIPIENT_COUNTER = [
  "The duties in this agreement last for three years from the date of the last signature, or until either side ends the relationship in writing, whichever is later.",
  "Duties about trade secrets last for as long as the information remains a trade secret.",
];

export const Q4_RETAINER: DocumentSource = {
  title: "Q4 retainer",
  sections: [
    {
      id: "services",
      heading: "Services",
      paragraphs: [
        "The Studio will provide up to 40 hours of design and development support each month from October to December.",
        "Unused hours do not carry over to the next month.",
      ],
    },
    {
      id: "fees",
      heading: "Fees",
      paragraphs: [
        "The retainer is 6,000 USD per month, invoiced at the start of each month and due within 15 days.",
      ],
    },
    {
      id: "term",
      heading: "Term",
      paragraphs: ["The retainer ends on 31 December. Renewing it needs a new agreement."],
    },
  ],
};

export const OFFICE_SUBLEASE: DocumentSource = {
  title: "Office sublease",
  sections: [
    {
      id: "space",
      heading: "The space",
      paragraphs: [
        "The Studio subleases the second-floor office suite at 14 Mill Street, including two meeting rooms and shared kitchen access, to the Client.",
      ],
    },
    {
      id: "rent",
      heading: "Rent and deposit",
      paragraphs: [
        "Rent is 3,200 USD per month, due on the first of the month. The Client pays a deposit of one month's rent, returned within 30 days after the sublease ends if the space is left in good condition.",
      ],
    },
    {
      id: "use",
      heading: "Use of the space",
      paragraphs: [
        "The Client will use the suite only as an office, follow the building rules and tell the Studio about any damage promptly.",
      ],
    },
    {
      id: "term",
      heading: "Term",
      paragraphs: [
        "The sublease runs for twelve months from the signing date. Either side may end it early with 60 days written notice.",
      ],
    },
  ],
};

export const EQUIPMENT_LEASE: DocumentSource = {
  title: "Equipment lease",
  sections: [
    {
      id: "equipment",
      heading: "Equipment",
      paragraphs: [
        "The Studio leases the camera kit and lighting set listed in Schedule A to the Client.",
      ],
    },
    {
      id: "payments",
      heading: "Payments",
      paragraphs: [
        "The Client pays 850 USD per month for the equipment, due on the first of the month, and is responsible for loss or damage while it holds the equipment.",
      ],
    },
    {
      id: "term",
      heading: "Term",
      paragraphs: [
        "The lease runs for six months. The Client returns the equipment in working order on the last day.",
      ],
    },
  ],
};

export const SPEAKING_ENGAGEMENT: DocumentSource = {
  title: "Speaking engagement",
  sections: [
    {
      id: "event",
      heading: "The event",
      paragraphs: [
        "The Speaker will give one 45-minute talk at the Harbor Legal annual conference on 14 March, followed by a 15-minute question period.",
      ],
    },
    {
      id: "fee",
      heading: "Fee and travel",
      paragraphs: [
        "Harbor Legal will pay a fee of 4,500 USD within 30 days of the talk and will book and pay for the Speaker's travel and one night of accommodation.",
      ],
    },
    {
      id: "recording",
      heading: "Recording",
      paragraphs: [
        "Harbor Legal may record the talk for its own members. It needs the Speaker's written permission to share the recording more widely.",
      ],
    },
    {
      id: "term",
      heading: "Term",
      paragraphs: [
        "This agreement ends once the fee is paid. Either side may cancel up to 30 days before the event without cost.",
      ],
    },
  ],
};

export const LOGO_BRIEF: DocumentSource = {
  title: "Logo design brief",
  sections: [
    {
      id: "deliverables",
      heading: "Deliverables",
      paragraphs: [
        "The Studio will deliver three logo concepts, two rounds of revisions on the chosen concept, and final files in vector and PNG formats.",
      ],
    },
    {
      id: "fee",
      heading: "Fee and schedule",
      paragraphs: [
        "The fixed fee is 3,200 USD, invoiced half on signing and half on delivery. Concepts arrive within two weeks of signing.",
      ],
    },
    {
      id: "rights",
      heading: "Rights",
      paragraphs: [
        "On full payment the Client owns the chosen logo. The Studio may show the work in its portfolio.",
      ],
    },
  ],
};

/** A copy of the source with one section's paragraphs replaced. */
export function withSection(
  source: DocumentSource,
  sectionId: string,
  paragraphs: readonly string[],
): DocumentSource {
  return {
    ...source,
    sections: source.sections.map((section) =>
      section.id === sectionId ? { ...section, paragraphs: [...paragraphs] } : section,
    ),
  };
}

export const PHOTOGRAPHY_LICENSE: DocumentSource = {
  title: "Photography license",
  sections: [
    {
      id: "grant",
      heading: "Grant",
      paragraphs: [
        "The Photographer grants the Client a non-exclusive license to use the photographs delivered under this agreement on the Client's website, in print marketing and in paid social advertising.",
      ],
    },
    {
      id: "fee",
      heading: "Fee and credit",
      paragraphs: [
        "The license fee is 1,800 USD, due within 30 days of delivery. The Client will credit the Photographer where reasonably possible.",
      ],
    },
    {
      id: "term",
      heading: "Term and territory",
      paragraphs: [
        "The license lasts for three years from delivery and covers the United States and Canada.",
      ],
    },
    {
      id: "ownership",
      heading: "Ownership",
      paragraphs: [
        "The Photographer keeps copyright in all photographs. The Client may not sell or sublicense them.",
      ],
    },
  ],
};

/** Sam's proposed grant for the Photography license: no paid social advertising. */
export const PHOTOGRAPHY_GRANT_WITHOUT_ADS = [
  "The Photographer grants the Client a non-exclusive license to use the photographs delivered under this agreement on the Client's website and in print marketing.",
];
