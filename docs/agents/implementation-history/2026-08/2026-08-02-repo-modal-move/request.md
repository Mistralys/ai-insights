I am missing the possibility to move a repository definition into another storage in the GUI. The repository edit modal should have an input field to do so, like when adding a repository.

In the same move, we should move the add repository input form into a modal to avoid duplicating validation and input rendering.

## Discussion

**Q: Should the add and edit share a single modal (like `csRenderStoreModal` does with a `mode` parameter), or should the detail/edit page remain a separate full-page view while only the add becomes a modal?**

A: Share a single modal.

**Q: Should the move be a separate action button (e.g., "Move to Store" dropdown) or integrated into the existing save flow?**

A: Integrated into the save flow — based on the premise that this cuts down on separate UI elements. The select is already there for adding, so re-using it for editing makes sense.

**Q: Should the full-page detail view (`#/strategy/:repoId`) remain for editing vision fields, with the modal only for quick add?**

A: Modal replaces detail page. All editing in the modal; detail route removed.
