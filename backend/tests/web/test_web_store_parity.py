"""The test double must know every collection the real store knows.

This exists because of a failure that wasted a cycle and would waste another.
Adding two collections to `WebStore` and forgetting `FakeStore` does not produce a
failing assertion — it produces `AttributeError: 'FakeStore' object has no
attribute 'coding_problems'` from inside a route, on fourteen unrelated tests at
once, which reads like a broken feature rather than a missing line in a fixture.

One assertion turns that into a single obvious failure naming the missing
collection.
"""

from __future__ import annotations

from tests.web.conftest import FakeStore


def _collections(obj: object) -> set[str]:
    """Attribute names that look like collections, not helpers or internals."""
    return {
        name
        for name in vars(obj)
        if not name.startswith("_") and hasattr(getattr(obj, name), "get")
    }


def test_the_fake_store_covers_every_real_collection() -> None:
    from app.web.store.db import WebStore

    # Constructed with a sentinel client: WebStore only holds it, and every
    # Collection is built eagerly in __init__, so nothing is dereferenced here.
    real = _collections(WebStore(client=object()))  # type: ignore[arg-type]
    fake = _collections(FakeStore())

    missing = sorted(real - fake)
    assert not missing, (
        "these collections exist on WebStore but not on the test double, so any "
        f"route touching them fails with AttributeError: {missing}"
    )
