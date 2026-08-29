---
name: preferred-python-style
description: Apply Sawyer's preferred Python conventions for implementation, docstrings, typing, unit tests, and reusable integration-test harnesses. Use when writing, changing, or reviewing Python code and tests, especially when deciding how strongly to follow local patterns versus improving them.
---

# Preferred Python Style

Write Python that makes its domain contracts explicit and makes whole categories of failures easy to test.

## Apply the standard in context

- Follow these standards dogmatically in greenfield code.
- In an existing area, respect its local patterns and move touched code toward these standards.
- Keep improvements relevant to the change. Do not force a broad rewrite to make nearby code conform.

## Model explicit contracts

- Type every production function's inputs and return value.
- Use `from __future__ import annotations` when the supported Python version benefits from it.
- Prefer explicit domain types over loose dictionaries, tuples, sentinel values, and primitive obsession.
- Use constrained `TypeVar`s, `Generic`, `Protocol`, `Self`, discriminated unions, and named aliases when they express a real contract. Do not add decorative abstraction.
- Represent expected outcomes as explicit result variants when failure is part of normal control flow.
- Prefer immutable models and dataclasses. For Pydantic domain models, default to forbidding extra fields and freezing values unless mutation or permissive input is part of the contract.
- Use literal discriminators such as `kind` for unions that cross runtime or serialization boundaries.
- Prefer keyword-only parameters when positional arguments would be ambiguous.
- Keep ownership clear. Do not import or access private members across module boundaries.

## Write docstrings for readers

- Give the first paragraph one or more concise sentences that explain **what** the object does and **why** it exists.
- Use the next paragraph to explain **how** and **when** callers should use it.
- Add more detail only for constraints, invariants, lifecycle semantics, or distinctions the types cannot express.
- Do not repeat the signature or add boilerplate `Args`, `Returns`, or `Raises` sections when names and types already communicate those facts.
- Use comments for local rationale and the meaning of constants, not to narrate the code.

Example:

```python
def normalize_source(value: str) -> NormalizedSource | NormalizationFailed:
    """Convert source text into the canonical value used for matching.

    Use this at ingestion boundaries before persistence or comparison so all
    downstream code receives one stable representation.
    """
```

## Test small contracts directly

- Keep focused unit tests for pure transformations, branches, error contracts, and other small behavior boundaries.
- Give each new or changed production function or method at least one direct unit test.
- Name tests for observable behavior: `test_<subject>_<behavior>`.
- Parameterize related cases and give every case a meaningful behavioral ID.
- Assert the full useful contract, including shape, ordering, encoding, discriminator, or other invariants where relevant.
- Match explicit result variants and fail loudly on unexpected variants.
- Use `pytest.raises(..., match=...)` for exception contracts.
- Keep unit tests deterministic, local, and easy to read.

## Build harnesses for system behavior

For tests beyond a unit boundary, prefer a reusable harness and realistic substitutes over a growing set of one-off test cases and interaction mocks.

- Model the lifecycle as **seed → system → execute → measure**.
- Declare scenario inputs as typed seeds and expected guarantees as typed measurements.
- Put realistic setup and fixture plumbing in the harness so each scenario shows only the meaningful inputs and outcomes.
- Prefer real local dependencies or faithful substitutes, such as a real test database or a realistic service emulator, over mocks that only assert calls.
- Keep execution separate from measurement. Measure observable state and outcomes, not private implementation steps.
- Parameterize scenarios with descriptive behavioral IDs.
- When production exposes a bug, extend the harness along the missing behavior dimension and add the failure as a scenario. Make the new capability able to catch other bugs in the same category, not only the reported example.
- Reuse the expanded harness for future scenarios so its coverage compounds over time.

Use a conventional test instead when a harness would add more machinery than reusable confidence.
