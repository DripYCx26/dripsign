import type { EditableSection } from "../document/sections.ts";
import { randomId } from "../document/ids.ts";

export type TemplateId = "nda" | "services";

interface Template {
  readonly label: string;
  /** The agreement title the starter sets. */
  readonly title: string;
  readonly sections: readonly Readonly<{ heading: string; paragraphs: readonly string[] }>[];
}

/** The one section "New agreement" starts with; a draft still holding only it is blank. */
export const STARTER_SECTION = {
  id: "terms",
  heading: "Terms",
  paragraphs: ["Write the terms here, or start from a template."],
} as const;

/** Shown wherever a starter template is in use. */
export const TEMPLATE_NOTE = "Starter text. Have it reviewed before you rely on it.";

const TEMPLATES: Readonly<Record<TemplateId, Template>> = {
  nda: {
    label: "Mutual NDA",
    title: "Mutual non-disclosure agreement",
    sections: [
      {
        heading: "Purpose",
        paragraphs: [
          "The parties want to talk about [describe the project or opportunity]. To do that, each may share information the other should keep private. This agreement sets out how that information is protected.",
        ],
      },
      {
        heading: "Confidential information",
        paragraphs: [
          "Confidential information is anything one party (the discloser) shares with the other (the recipient) that is marked confidential or that a reasonable person would understand to be confidential, whether it is shared in writing, out loud or by showing it.",
        ],
      },
      {
        heading: "What each party agrees to do",
        paragraphs: [
          "The recipient will use the discloser’s confidential information only for the purpose above, will keep it as private as it keeps its own confidential information (and no less than with reasonable care), and will share it only with people who need it for the purpose and are bound to keep it confidential.",
        ],
      },
      {
        heading: "What is not covered",
        paragraphs: [
          "This agreement does not cover information that is or becomes public through no fault of the recipient, that the recipient already knew or learned from someone else without a duty to keep it private, or that the recipient developed on its own. A recipient may share information when the law or a court requires it, if it tells the discloser first where the law allows.",
        ],
      },
      {
        heading: "How long this lasts",
        paragraphs: [
          "This agreement applies to information shared during the next [two] years. Each party’s duty to protect information it received continues for [three] years after this agreement ends.",
        ],
      },
      {
        heading: "Returning information",
        paragraphs: [
          "When the discloser asks, the recipient will return or delete the discloser’s confidential information and confirm that it has done so, except for copies it must keep by law or in routine backups, which stay protected.",
        ],
      },
      {
        heading: "No other rights",
        paragraphs: [
          "Sharing information does not give the recipient any ownership of it or any licence beyond the purpose above, and it does not oblige either party to make a deal.",
        ],
      },
      {
        heading: "General",
        paragraphs: [
          "This is the whole agreement about confidential information between the parties. Changes must be in writing and agreed by both. This agreement is governed by the laws of [state or country].",
        ],
      },
    ],
  },
  services: {
    label: "Services agreement",
    title: "Services agreement",
    sections: [
      {
        heading: "The services",
        paragraphs: [
          "The provider will do the work described here: [describe the services and what will be delivered]. Anything not described is not included unless both parties agree to it in writing.",
        ],
      },
      {
        heading: "Timeline",
        paragraphs: [
          "Work starts on [start date] and the provider aims to finish by [end date]. The client will give feedback and any materials the provider needs within [five] business days of being asked, and dates move by the same amount if it takes longer.",
        ],
      },
      {
        heading: "Fees and payment",
        paragraphs: [
          "The client will pay the provider [amount] for the services. The provider will invoice [when], and the client will pay each invoice within [30] days of receiving it. Agreed expenses are paid at cost with receipts.",
        ],
      },
      {
        heading: "Changes",
        paragraphs: [
          "If either party wants to change the work, the timeline or the fees, it will say so in writing. A change applies only once both parties have agreed to it.",
        ],
      },
      {
        heading: "Who owns the work",
        paragraphs: [
          "Once the client has paid in full, the client owns the finished work the provider creates for it under this agreement. The provider keeps ownership of its own tools and methods, and gives the client the right to use them as part of the finished work.",
        ],
      },
      {
        heading: "Keeping things private",
        paragraphs: [
          "Each party will keep the other’s non-public business information private and use it only for this agreement.",
        ],
      },
      {
        heading: "Ending this agreement",
        paragraphs: [
          "Either party may end this agreement by giving [14] days’ written notice. The client will pay for work done up to the end date. Either party may end it at once if the other seriously breaks it and does not fix the problem within [10] days of being told.",
        ],
      },
      {
        heading: "Responsibility",
        paragraphs: [
          "Neither party is responsible to the other for indirect or consequential losses. Each party’s total responsibility under this agreement is limited to the fees paid or owed under it, except where the law does not allow a limit.",
        ],
      },
      {
        heading: "General",
        paragraphs: [
          "This is the whole agreement between the parties about the services. Changes must be in writing and agreed by both. This agreement is governed by the laws of [state or country].",
        ],
      },
    ],
  },
};

export const TEMPLATE_OPTIONS: readonly Readonly<{ value: TemplateId; label: string }>[] = [
  { value: "nda", label: TEMPLATES.nda.label },
  { value: "services", label: TEMPLATES.services.label },
];

/** Fresh sections, with new ids, so two agreements never share a section id. */
export function templateSections(id: TemplateId): EditableSection[] {
  return TEMPLATES[id].sections.map((section) => ({
    id: randomId(),
    heading: section.heading,
    body: section.paragraphs.join("\n\n"),
  }));
}

export function templateTitle(id: TemplateId): string {
  return TEMPLATES[id].title;
}
