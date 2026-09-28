"""Rebuild data/vocabulary.json (compact, used by the app) from data/vocabulary-full.json (easy to edit).

Usage:  python3 tools/build_vocab.py
Edit words, translations, notes or categories in vocabulary-full.json, run this, then redeploy.
"""
import json, pathlib
root = pathlib.Path(__file__).resolve().parent.parent
full = json.loads((root / "data" / "vocabulary-full.json").read_text(encoding="utf-8"))
cat_ids = [c["id"] for c in full["categories"]]
out = {
    "cats": [[c["id"], c["name"], c["emoji"], c["group"]] for c in full["categories"]],
    "cards": [[c["id"], c["fr"], c["en"], c.get("gender", ""), c.get("type", ""), c.get("pron", ""), c.get("note", ""), cat_ids.index(c["cat"])]
              for c in full["cards"]],
}
(root / "data" / "vocabulary.json").write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
print(f"Wrote {len(out['cards'])} cards in {len(out['cats'])} categories.")
