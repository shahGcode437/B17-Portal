import type { Tutor } from "@/types/tutor"

/**
 * Demo tutor/professional listings (Prototype Data Contract: 3–5).
 * Fictional names (first name + initial) — not real verified people.
 */
export const tutors: Tutor[] = [
  {
    id: "tutor-physics-01",
    name: "Sara M.",
    subject: "Physics",
    grade: "Grade 9",
    area: "B-17, Block C (Demo Area)",
    bio: "Physics tutor focused on O/A-level and matric board preparation.",
    image: "/images/tutors/physics-tutor.jpg",
    tags: ["physics", "tutor", "grade 9", "science"],
  },
  {
    id: "tutor-math-01",
    name: "Ahmed R.",
    subject: "Mathematics",
    grade: "Grade 10",
    area: "B-17, Block A (Demo Area)",
    bio: "Mathematics tutor specializing in algebra and exam preparation.",
    image: "/images/tutors/math-tutor.jpg",
    tags: ["mathematics", "tutor", "grade 10", "algebra"],
  },
  {
    id: "tutor-english-01",
    name: "Bilal T.",
    subject: "English",
    grade: "Grade 8",
    area: "B-17, Block D (Demo Area)",
    bio: "English language tutor for grammar, writing and comprehension.",
    image: "/images/tutors/english-tutor.jpg",
    tags: ["english", "tutor", "grade 8", "language"],
  },
  {
    id: "tutor-chemistry-01",
    name: "Hina F.",
    subject: "Chemistry",
    grade: "Grade 11",
    area: "B-17, Block B (Demo Area)",
    bio: "Chemistry tutor for intermediate and A-level students.",
    tags: ["chemistry", "tutor", "grade 11", "science"],
  },
]
