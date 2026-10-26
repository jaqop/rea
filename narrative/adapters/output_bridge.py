"""Fixed local optional-provider bridge. One JSON request, one JSON response.

Uses public Reweave Document/extractor/regenerator/guard/checker APIs and
simple-lama-inpainting SimpleLama with LAMA_MODEL set to an existing local file.
No provider installation, model downloads, shell execution or metadata mutation.
"""
import contextlib
import importlib
import importlib.util
import json
import math
import os
import re
import tempfile
import unicodedata
from collections import Counter
from pathlib import Path
import sys
import urllib.request

MAX_REQUEST = 1024 * 1024 + 16384
HOST = "http://127.0.0.1:11434"
LAYOUT = re.compile(r"(\r\n|[\r\n\v\f\x1c-\x1f\x85\u2028\u2029])")
OPAQUE = re.compile(r"⟦REA_PROTECTED_[0-9a-fx]+_\d+⟧")
urllib.request.install_opener(urllib.request.build_opener(urllib.request.ProxyHandler({})))


def required_text(value, name):
    if not isinstance(value, str) or not value.strip() or "\0" in value:
        raise ValueError(f"{name} must be nonempty text")
    return value


def module_status(name):
    try:
        return importlib.util.find_spec(name) is not None
    except (ImportError, ModuleNotFoundError, ValueError):
        return False


def reweave_api():
    from reweave.core.types import Document, VoiceProfile
    from reweave.extract.ollama_extractor import OllamaExtractor
    from reweave.regenerate.ollama_regenerator import OllamaRegenerator
    from reweave.guard import OllamaEmbeddingGuard
    from reweave.verify import ConstraintChecker
    return Document, VoiceProfile, OllamaExtractor, OllamaRegenerator, OllamaEmbeddingGuard, ConstraintChecker


def ollama_status():
    try:
        with urllib.request.urlopen(HOST + "/api/tags", timeout=2) as response:
            data = response.read(1024 * 1024 + 1)
        if len(data) > 1024 * 1024:
            raise ValueError("Ollama model inventory exceeds 1 MiB")
        models = json.loads(data).get("models", [])
        names = sorted({item["name"] for item in models if isinstance(item, dict) and isinstance(item.get("name"), str)})
        return {"running": True, "models": names, "host": HOST}
    except Exception as error:
        return {"running": False, "models": [], "host": HOST, "reason": str(error)[:1000]}


def model_present(names, model):
    return model in names or (":" not in model and model + ":latest" in names)


def capabilities(request):
    isolated = sys.prefix != sys.base_prefix
    installed = module_status("reweave")
    compatible = False
    reason = None
    if installed:
        try:
            reweave_api()
            compatible = True
        except Exception as error:
            reason = str(error)[:1000]
    ollama = ollama_status()
    missing = [model for model in ["gemma3:4b", "all-minilm"] if not model_present(ollama["models"], model)]
    lama_installed = all(module_status(name) for name in ["simple_lama_inpainting", "PIL", "torch"])
    lama_importable = False
    lama_reason = None
    if lama_installed:
        try:
            from simple_lama_inpainting import SimpleLama  # import only; do not construct/download
            from PIL import Image
            lama_importable = callable(SimpleLama) and Image is not None
        except Exception as error:
            lama_reason = str(error)[:1000]
    model_path = request.get("model_path")
    local_model = isinstance(model_path, str) and Path(model_path).is_file()
    return {"status": "available", "python_executable": sys.executable, "isolated_venv": isolated, "isolated_venv_required": False, "isolated_venv_recommended": True, "reweave": {"installed": installed, "api_compatible": compatible, "reason": reason, "ollama": ollama, "required_models": ["gemma3:4b", "all-minilm"], "missing_models": missing, "ready": compatible and ollama["running"] and not missing}, "lama": {"installed": lama_installed, "api_compatible": lama_importable, "reason": lama_reason, "model_file_present": bool(local_model), "ready": lama_importable and bool(local_model), "weights_loaded": False}, "statistical_removal": "statistical_removal_not_verified"}


def source_language(text):
    visible = OPAQUE.sub("", text)
    names = [unicodedata.name(char, "") for char in visible if unicodedata.category(char).startswith("L")]
    if not names:
        return None
    arabic = sum("ARABIC" in name for name in names)
    latin = sum("LATIN" in name for name in names)
    if arabic > latin:
        return "Arabic"
    if latin > arabic:
        return "English"
    return "the original source language"


def relative_time_counts(text):
    """Partial lexical guard only; does not establish temporal or semantic equivalence."""
    visible = OPAQUE.sub("", text)
    normalized = "".join(char for char in unicodedata.normalize("NFD", visible.casefold()) if not unicodedata.category(char).startswith("M"))
    vocabulary = {"today", "now", "yesterday", "tomorrow", "اليوم", "الان", "امس", "غدا"}
    return Counter(word for word in re.findall(r"[^\W\d_]+", normalized) if word in vocabulary)


def rewrite_segments(text):
    """Partition every input character; never cut a word or send newline separators."""
    if len(text.encode("utf-8")) > 4096:
        raise ValueError("Rewrite text exceeds 4096 UTF8 bytes")
    segments = []
    for line in LAYOUT.split(text):
        words = list(re.finditer(r"\S+", line))
        if not words:
            if line:
                segments.append((line, False))
            continue
        for word in words:
            if len(word.group().encode("utf-8")) > 512:
                raise ValueError("Rewrite token exceeds 512 UTF8 bytes; words cannot be split")
        cursor = 0
        first = words[0].start()
        end = words[0].end()
        for word in words[1:]:
            if len(line[first:word.end()].encode("utf-8")) > 512:
                if first > cursor:
                    segments.append((line[cursor:first], False))
                segments.append((line[first:end], True))
                cursor = end
                first = word.start()
            end = word.end()
        if first > cursor:
            segments.append((line[cursor:first], False))
        segments.append((line[first:end], True))
        if end < len(line):
            segments.append((line[end:], False))
    return segments


def rewrite(request):
    text = required_text(request.get("text"), "text")
    segments = rewrite_segments(text)
    model = required_text(request.get("model"), "model")
    if not any(transform and source_language(segment) is not None for segment, transform in segments):
        return {"text": text, "status": "protected_text_unchanged", "model": model, "semantic_similarity": 1.0, "fact_check_passed": True, "verified_chunks": 0, "statistical_removal": "statistical_removal_not_verified", "semantic_fidelity_guaranteed": False, "limitations": ["Only protected placeholders, whitespace, numbers or punctuation were present; no model or semantic checks ran", "Unchanged text and a score of 1.0 are not semantic verification"]}
    status = ollama_status()
    if not status["running"]:
        raise RuntimeError("Local Ollama is unavailable; start your existing local service explicitly")
    missing = [name for name in [model, "all-minilm"] if not model_present(status["models"], name)]
    if missing:
        raise RuntimeError("Required local models are not installed: " + ", ".join(missing) + "; no models were downloaded")
    Document, VoiceProfile, Extractor, Regenerator, Guard, Checker = reweave_api()
    class BoundedRegenerator(Regenerator):
        language = "English"

        def _prompt(self, meaning, voice, aggressiveness):
            return super()._prompt(meaning, voice, aggressiveness) + ("\nKeep the source language: " + self.language + ". Do not translate. Preserve every opaque placeholder exactly once and in its original order. Do not change, explain, expand or delete placeholders. Do not turn event-bound dates or weekdays into current-time, today, now, yesterday or tomorrow assertions. Preserve temporal binding, negation, modality and participants. Return one paragraph only, without introductions, commentary or Markdown fences.")

    extractor = Extractor(model=model, host=HOST)
    regenerator = BoundedRegenerator(model=model, host=HOST)
    guard = Guard(model="all-minilm", host=HOST, timeout=30.0)
    checker = Checker()
    output = []
    similarities = []
    for segment, transform in segments:
        language = source_language(segment) if transform else None
        if language is None:
            output.append(segment)
            continue
        original = Document(segment)
        regenerator.language = language
        meaning = extractor.extract(original)
        candidate = regenerator.regenerate(meaning, VoiceProfile(), 0.5)
        required_text(candidate.text, "Candidate text")
        ratio = len(candidate.text.encode("utf-8")) / len(segment.encode("utf-8"))
        if LAYOUT.search(candidate.text) or not 0.65 <= ratio <= 1.6 or len(candidate.text.encode("utf-8")) > 512:
            raise RuntimeError("Rewrite chunk rejected by complete-coverage, paragraph or length-ratio gate; no replacement returned")
        if relative_time_counts(segment) != relative_time_counts(candidate.text):
            raise RuntimeError("Rewrite chunk rejected by partial relative-time assertion guard; no replacement returned")
        similarity = float(guard.similarity(original, candidate))
        facts = checker.check(original, candidate)
        if not math.isfinite(similarity) or similarity < 0.82 or not facts.ok:
            raise RuntimeError("Rewrite chunk rejected by similarity/fact gate; no replacement returned")
        similarities.append(similarity)
        output.append(candidate.text)
    return {"text": "".join(output), "status": "model_rewrite_best_effort", "model": model, "semantic_similarity": min(similarities), "fact_check_passed": True, "verified_chunks": len(similarities), "chunk_utf8_limit": 512, "input_utf8_limit": 4096, "statistical_removal": "statistical_removal_not_verified", "semantic_fidelity_guaranteed": False, "limitations": ["Every prose chunk is checked; original layout separators and non-prose chunks are retained exactly", "The relative-time vocabulary count guard is partial and cannot prove semantic equivalence, event-time binding, negation or motives", "No watermark detector or secret key was evaluated", "Embedding similarity and lexical fact checks are incomplete, particularly outside English", "A human must review meaning, voice and factual accuracy"]}


def image(request):
    paths = {key: Path(required_text(request.get(key), key)).resolve() for key in ["input_path", "mask_path", "output_path", "model_path"]}
    for key in ["input_path", "mask_path", "model_path"]:
        if not paths[key].is_file():
            raise ValueError(f"{key} must be an existing local regular file")
    output = paths["output_path"]
    if output.exists():
        raise ValueError("output_path already exists; image outputs never overwrite files")
    if output.suffix.lower() != ".png":
        raise ValueError("output_path must be a new PNG file")
    from PIL import Image
    Image.MAX_IMAGE_PIXELS = 16_000_000
    with Image.open(paths["input_path"]) as source, Image.open(paths["mask_path"]) as mask_source:
        if source.size != mask_source.size:
            raise ValueError("Image and explicit mask dimensions must match")
        if source.width * source.height > 16_000_000:
            raise ValueError("Image exceeds 16 million pixels")
        source.load()
        mask_source.load()
        if source.mode not in ("RGB", "RGBA"):
            raise ValueError("Image mode must be RGB or RGBA; convert other modes explicitly first")
        alpha = source.getchannel("A").copy() if source.mode == "RGBA" else None
        icc_profile = source.info.get("icc_profile")
        picture = source.convert("RGB")
        mask = mask_source.convert("L")
    if any(value not in (0, 255) for value in mask.getdata()):
        raise ValueError("Explicit mask must be binary: black keeps pixels, white requests inpainting")
    if mask.getextrema()[1] == 0:
        raise ValueError("Explicit mask has no white pixels to inpaint")
    os.environ["LAMA_MODEL"] = str(paths["model_path"])
    from simple_lama_inpainting import SimpleLama
    generated = SimpleLama()(picture, mask)
    # The upstream tensor helper pads dimensions to multiples of eight. Return
    # original dimensions and preserve every unmasked pixel explicitly.
    generated = generated.crop((0, 0, picture.width, picture.height))
    result = Image.composite(generated, picture, mask)
    if alpha is not None:
        result.putalpha(alpha)
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(mode="w+b", dir=output.parent, prefix=".rea-image-", suffix=".png", delete=False) as destination:
            temporary = Path(destination.name)
            result.save(destination, format="PNG", **({"icc_profile": icc_profile} if icc_profile is not None else {}))
            destination.flush()
            os.fsync(destination.fileno())
        try:
            os.link(temporary, output)
        except FileExistsError:
            raise
        except OSError as error:
            raise RuntimeError("Atomic nonoverwriting image publication failed; this filesystem or permission policy may not support hard links. No non-atomic fallback was attempted: " + str(error)) from error
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)
    return {"status": "image_inpainted", "provider": "simple-lama-inpainting", "output_path": str(output), "width": result.width, "height": result.height, "alpha_preserved": alpha is not None, "icc_profile_preserved": icc_profile is not None, "limitations": ["Generated pixels are an approximation, not recovered original pixels", "No invisible watermark, provenance or metadata removal is verified", "LaMa handles images only; text uses a separate provider"]}


def main():
    raw = sys.stdin.buffer.readline(MAX_REQUEST + 1)
    if len(raw) > MAX_REQUEST:
        raise ValueError("Provider request exceeds bounded JSON input")
    request = json.loads(raw)
    if not isinstance(request, dict):
        raise ValueError("Provider request must be an object")
    operation = request.get("operation")
    if operation == "capabilities":
        return capabilities(request)
    if operation == "rewrite":
        return rewrite(request)
    if operation == "image":
        return image(request)
    raise ValueError("Unknown fixed provider operation")


def serialize_response(response):
    try:
        serialized = json.dumps(response, ensure_ascii=False, allow_nan=False) + "\n"
        serialized.encode("utf-8")
        return serialized
    except Exception as error:
        return json.dumps({"ok": False, "error": {"code": "SerializationError", "message": str(error)[:2000]}}, ensure_ascii=True, allow_nan=False) + "\n"


if __name__ == "__main__":
    try:
        with contextlib.redirect_stdout(sys.stderr):
            result = main()
        response = {"ok": True, "result": result}
    except Exception as error:
        response = {"ok": False, "error": {"code": type(error).__name__, "message": str(error)[:2000]}}
    sys.stdout.buffer.write(serialize_response(response).encode("utf-8"))
    sys.stdout.buffer.flush()
