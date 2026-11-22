import { describe, expect, it } from "vitest";
import { formatPosting, splitLinks, type PostingBlock } from "@/lib/postingFormat";

/** A pasted posting, one line per element (leading spaces kept, as they come from a copied web page). */
const paste = (...lines: string[]) => lines.join("\n");

const SHOPIFY = paste(
  "About the role",
  " Read through our Internships FAQ https://internships.shopify.com/a/faq/ to help answer any questions you may have about internships at Shopify.",
  "Being a Shopify Intern:",
  "Our hiring process is unique. We hire interns and place them on teams we think they'd be successful on.",
  "We are looking primarily for interns to fill a large number of internship roles in Software Engineering:",
  " Software Engineering: crafting the code that powers commerce, creating the extendable products that scale the entire commerce stack.",
  "Candidates with relevant experience may also be considered for internships within these areas:",
  " Infrastructure Engineering: building and developing the blocks that move all of Shopify forward.",
  " Security Engineering: detecting, evaluating, and addressing security threats to Shopify and its merchants.",
  "Working at Shopify:",
  " You must be legally entitled to work in the location you are applying to for the entire duration of the summer internship term.",
);

describe("formatPosting: normalizing", () => {
  it("treats CRLF, lone CR and NBSP alike, trims line ends, and collapses blank runs", () => {
    const messy = "Responsibilities\r\n\r\n\r\nBuild the search index. \t\r\n\n\nRun the on-call rotation.   ";
    expect(formatPosting(messy)).toEqual([
      { kind: "heading", text: "Responsibilities" },
      { kind: "para", text: "Build the search index." },
      { kind: "para", text: "Run the on-call rotation." },
    ]);
  });

  it("returns nothing for empty or blank input", () => {
    expect(formatPosting("")).toEqual([]);
    expect(formatPosting("  \n\n \t ")).toEqual([]);
  });
});

describe("formatPosting: bullets", () => {
  it.each(["•", "●", "▪", "◦", "·", "-", "–", "*"])("reads %s as a bullet and strips it", (marker) => {
    expect(formatPosting(paste(`${marker} Python`, `${marker} SQL`))).toEqual([
      { kind: "list", items: ["Python", "SQL"] },
    ]);
  });

  it("reads 1. and 1) numbered markers, and not a number that isn't a marker", () => {
    expect(formatPosting(paste("1. Write tests", "2) Ship it"))).toEqual([
      { kind: "list", items: ["Write tests", "Ship it"] },
    ]);
    expect(formatPosting("2024 was a good year.")).toEqual([{ kind: "para", text: "2024 was a good year." }]);
  });

  it("makes consecutive items one list, and keeps it one list across blank lines", () => {
    expect(formatPosting(paste("• A", "• B", "", "• C"))).toEqual([{ kind: "list", items: ["A", "B", "C"] }]);
  });

  it("splits a line with several ' • ' separators into items", () => {
    expect(formatPosting("Python • SQL • Docker")).toEqual([{ kind: "list", items: ["Python", "SQL", "Docker"] }]);
  });

  it("leaves a line with a single ' • ' as one paragraph", () => {
    expect(formatPosting("Remote • Full-time")).toEqual([{ kind: "para", text: "Remote • Full-time" }]);
  });
});

describe("formatPosting: indented lines after a colon", () => {
  it("makes indented lines after a line ending in ':' list items, through the whole run", () => {
    expect(formatPosting(paste("We are looking for people to join us in these areas:", " Frontend work", " Backend work"))).toEqual([
      { kind: "para", text: "We are looking for people to join us in these areas:" },
      { kind: "list", items: ["Frontend work", "Backend work"] },
    ]);
  });

  it("keeps an indented line after a line without a colon as a paragraph", () => {
    expect(formatPosting(paste("Our team builds the checkout.", " Come help us ship it."))).toEqual([
      { kind: "para", text: "Our team builds the checkout." },
      { kind: "para", text: "Come help us ship it." },
    ]);
  });

  it("ends the run at a line that isn't indented", () => {
    expect(formatPosting(paste("Areas:", " Search", "Plus one more thing.", " Not an item after all."))).toEqual([
      { kind: "heading", text: "Areas" },
      { kind: "list", items: ["Search"] },
      { kind: "para", text: "Plus one more thing." },
      { kind: "para", text: "Not an item after all." },
    ]);
  });
});

describe("formatPosting: headings", () => {
  it("reads a short line with no sentence punctuation, followed by content, as a heading", () => {
    expect(formatPosting(paste("About the role", "We build payments."))).toEqual([
      { kind: "heading", text: "About the role" },
      { kind: "para", text: "We build payments." },
    ]);
  });

  it("drops a trailing ':' from a heading", () => {
    expect(formatPosting(paste("Being a Shopify Intern:", "Our process is unique."))[0]).toEqual({
      kind: "heading",
      text: "Being a Shopify Intern",
    });
  });

  it("reads ALL CAPS short lines as headings, even with nothing after them", () => {
    expect(formatPosting("WHAT YOU'LL DO")).toEqual([{ kind: "heading", text: "WHAT YOU'LL DO" }]);
  });

  it("does not make a heading of a short line with nothing after it", () => {
    expect(formatPosting(paste("Ship with us", ""))).toEqual([{ kind: "para", text: "Ship with us" }]);
  });

  it("does not make a heading of a line with sentence punctuation", () => {
    expect(formatPosting(paste("Apply today.", "Thanks."))).toEqual([
      { kind: "para", text: "Apply today." },
      { kind: "para", text: "Thanks." },
    ]);
  });

  it("does not make a heading of a line longer than 60 characters or 8 words", () => {
    const long = "We are looking primarily for interns to fill a large number of internship roles in Software Engineering:";
    expect(formatPosting(paste(long, "More below."))[0]).toEqual({ kind: "para", text: long });
    expect(formatPosting(paste("One two three four five six seven eight nine", "Next."))[0]).toEqual({
      kind: "para",
      text: "One two three four five six seven eight nine",
    });
  });

  it("does not make a heading of a line with a URL", () => {
    expect(formatPosting(paste("Apply at https://jobs/careers", "Thanks."))[0]).toEqual({
      kind: "para",
      text: "Apply at https://jobs/careers",
    });
  });

  it("keeps a long lead-in line that ends in ':' a paragraph, not a heading", () => {
    const blocks = formatPosting(paste("We are looking primarily for interns to join us in these areas:", " Search"));
    expect(blocks[0]).toEqual({ kind: "para", text: "We are looking primarily for interns to join us in these areas:" });
  });
});

describe("formatPosting: paragraphs and hard wraps", () => {
  it("joins a hard-wrapped sentence onto one line", () => {
    expect(formatPosting(paste("We are building a search engine for", "small shops across the country."))).toEqual([
      { kind: "para", text: "We are building a search engine for small shops across the country." },
    ]);
  });

  it("does not join when the line before ends a sentence", () => {
    expect(formatPosting(paste("We ship weekly.", "you will love it."))).toEqual([
      { kind: "para", text: "We ship weekly." },
      { kind: "para", text: "you will love it." },
    ]);
  });

  it("joins a hard-wrapped heading-like line rather than making it a heading", () => {
    expect(formatPosting(paste("We build tools that", "help every team ship faster."))).toEqual([
      { kind: "para", text: "We build tools that help every team ship faster." },
    ]);
  });

  it("keeps each separate line as its own paragraph", () => {
    expect(formatPosting(paste("First line here.", "Second line here."))).toEqual([
      { kind: "para", text: "First line here." },
      { kind: "para", text: "Second line here." },
    ]);
  });
});

describe("formatPosting: a realistic pasted posting", () => {
  it("reads the Shopify internship posting as a document", () => {
    const expected: PostingBlock[] = [
      { kind: "heading", text: "About the role" },
      {
        kind: "para",
        text: "Read through our Internships FAQ https://internships.shopify.com/a/faq/ to help answer any questions you may have about internships at Shopify.",
      },
      { kind: "heading", text: "Being a Shopify Intern" },
      {
        kind: "para",
        text: "Our hiring process is unique. We hire interns and place them on teams we think they'd be successful on.",
      },
      {
        kind: "para",
        text: "We are looking primarily for interns to fill a large number of internship roles in Software Engineering:",
      },
      {
        kind: "list",
        items: [
          "Software Engineering: crafting the code that powers commerce, creating the extendable products that scale the entire commerce stack.",
        ],
      },
      {
        kind: "para",
        text: "Candidates with relevant experience may also be considered for internships within these areas:",
      },
      {
        kind: "list",
        items: [
          "Infrastructure Engineering: building and developing the blocks that move all of Shopify forward.",
          "Security Engineering: detecting, evaluating, and addressing security threats to Shopify and its merchants.",
        ],
      },
      { kind: "heading", text: "Working at Shopify" },
      {
        kind: "list",
        items: [
          "You must be legally entitled to work in the location you are applying to for the entire duration of the summer internship term.",
        ],
      },
    ];
    expect(formatPosting(SHOPIFY)).toEqual(expected);
  });
});

describe("splitLinks", () => {
  it("splits text around bare URLs", () => {
    expect(splitLinks("Apply at https://jobs.example.com/1 today")).toEqual([
      { kind: "text", text: "Apply at " },
      { kind: "link", href: "https://jobs.example.com/1", text: "https://jobs.example.com/1" },
      { kind: "text", text: " today" },
    ]);
  });

  it("keeps the sentence's closing punctuation out of the link", () => {
    expect(splitLinks("See https://example.com/faq.")).toEqual([
      { kind: "text", text: "See " },
      { kind: "link", href: "https://example.com/faq", text: "https://example.com/faq" },
      { kind: "text", text: "." },
    ]);
  });

  it("returns plain text as one piece", () => {
    expect(splitLinks("No links here")).toEqual([{ kind: "text", text: "No links here" }]);
  });
});
