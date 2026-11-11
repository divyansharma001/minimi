---
{
  "id": "da8534e0",
  "title": "Which Node.js versions are LTS right now, and when did or does Node.js 20 reach…",
  "startedAt": "2026-11-11T14:35:13.897Z",
  "turns": [
    {
      "role": "user",
      "text": "Which Node.js versions are LTS right now, and when did or does Node.js 20 reach end of life?",
      "at": "2026-11-11T14:35:13.897Z",
      "day": "2026-11-11"
    },
    {
      "role": "assistant",
      "text": "**Short answer:** the LTS lines right now are Node.js 26, 24 and 22. Node.js 20 reached end of life on 30 April 2026.\n\n**LTS lines today (11 Nov 2026)**\n\n| Line | Status |\n| --- | --- |\n| 26 (Lithium) | LTS; entered Active LTS on 28 Oct 2026 [24][21] |\n| 24 (Krypton) | LTS [24] — sources disagree on Active vs Maintenance, see below |\n| 22 (Jod) | LTS [24]; Maintenance LTS [21] |\n\nEverything else is EOL: Node.js 20 and earlier, plus the odd lines 21, 23 and 25 [25].\n\n**Sources disagree on Node.js 24's phase**\n\n- HeroDevs (page updated 13 Oct 2026): \"Node.js 24 is the Active LTS line\" [2], and lists 26 as still Current, 24 as Active LTS, 22 as Maintenance LTS [1].\n- pkgpulse (page updated 1 Nov 2026): Node.js 24 is **Maintenance LTS**, with maintenance starting 20 Oct 2026 [21].\n- The official nodejs.org releases page just labels v24 \"LTS\" and does not name the phase [24].\n\nWhich is more reliable: pkgpulse's page is newer and falls after the 20 Oct 2026 maintenance date, so it best reflects where 24 is now; the HeroDevs text was written before that handover, so its \"Active LTS\" was right at the time. Since the official page only says \"LTS\", the safe reading is: 24 is LTS either way, with its phase in transition around late October 2026.\n\n**Node.js 20**\n\nNode.js 20 (Iron) reached end of life on **30 April 2026** [7][26], and the official releases page lists v20 as EOL [24].",
      "at": "2026-11-11T14:35:47.649Z",
      "day": "2026-11-11",
      "answerId": "6d34afc6"
    }
  ]
}
---

<!-- The data is in the block above. This text is written from it, so edit the block instead. -->

# Which Node.js versions are LTS right now, and when did or does Node.js 20 reach…

**You**, 11 Nov 2026, 14:35 UTC

Which Node.js versions are LTS right now, and when did or does Node.js 20 reach end of life?

**minimi**, 11 Nov 2026, 14:35 UTC

**Short answer:** the LTS lines right now are Node.js 26, 24 and 22. Node.js 20 reached end of life on 30 April 2026.

**LTS lines today (11 Nov 2026)**

| Line | Status |
| --- | --- |
| 26 (Lithium) | LTS; entered Active LTS on 28 Oct 2026 [24][21] |
| 24 (Krypton) | LTS [24] — sources disagree on Active vs Maintenance, see below |
| 22 (Jod) | LTS [24]; Maintenance LTS [21] |

Everything else is EOL: Node.js 20 and earlier, plus the odd lines 21, 23 and 25 [25].

**Sources disagree on Node.js 24's phase**

- HeroDevs (page updated 13 Oct 2026): "Node.js 24 is the Active LTS line" [2], and lists 26 as still Current, 24 as Active LTS, 22 as Maintenance LTS [1].
- pkgpulse (page updated 1 Nov 2026): Node.js 24 is **Maintenance LTS**, with maintenance starting 20 Oct 2026 [21].
- The official nodejs.org releases page just labels v24 "LTS" and does not name the phase [24].

Which is more reliable: pkgpulse's page is newer and falls after the 20 Oct 2026 maintenance date, so it best reflects where 24 is now; the HeroDevs text was written before that handover, so its "Active LTS" was right at the time. Since the official page only says "LTS", the safe reading is: 24 is LTS either way, with its phase in transition around late October 2026.

**Node.js 20**

Node.js 20 (Iron) reached end of life on **30 April 2026** [7][26], and the official releases page lists v20 as EOL [24].
