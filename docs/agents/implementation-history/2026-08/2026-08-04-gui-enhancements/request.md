# Request - GUI Enhancements

## Strategy / Repositories

- Sort the list by label by default.
- Make the columns "Label" and "ID" sortable.
- Fix the undeclared repositories not showing anything.

## Store Create/Edit Modal

- Move the "Label" input after "ID".
- Move the "Directory" before the "Path".
- In directory create mode, add a note for the "Path" element to explain whether the target path must include the ID (afaik this is added automatically? Adjust the text accordingly.)
- In existing directory mode, add a note for the "Path" element that the folder must be the root containing the project folders and `.repositories.json`.

## Configuration

- Move the "Stores" tab after "General".

## Projects List

- Add a "Repository" filter to easily sort by repository.

## Project Detail Pages - Breadcrumb Nav

- The Repository component in the breadcrumbs should link to the project list, filtered by repository (see the new "Projets list" filter).

## Project Detail Page

- Dynamic status updates in the work packages list do not update the "Assigned to" column: The stages get updated, but this stays on "-" the whole time, unless the page is reloaded manually.

