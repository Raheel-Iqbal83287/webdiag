import fs from "fs";
import type { CrawledFile, ModuleResult, AuditIssue } from "../../types.js";
import { calculateModuleScore } from "../../scoring.js";

function generateId(): string {
  return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

function attr(tag: string, name: string): string | null {
  const esc = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`${esc}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|(\\S+))`, "i");
  const m = tag.match(re);
  return m ? (m[1] !== undefined ? m[1] : m[2] !== undefined ? m[2] : m[3]) : null;
}

function isNestedInLabel(controlHtml: string, labelEls: string[]): boolean {
  const openTag = controlHtml.match(/<[a-zA-Z]+[\s>]/)?.[0];
  if (!openTag) return false;
  return labelEls.some((l) => {
    const start = l.indexOf(">") + 1;
    const end = l.lastIndexOf("</label>");
    return start > 0 && end > start && l.slice(start, end).includes(openTag);
  });
}

function findVisibleLabelText(controlHtml: string, formHtml: string): string | null {
  const idx = formHtml.indexOf(controlHtml);
  if (idx < 0) return null;
  const before = formHtml.slice(0, idx);
  const lastLabel = before.lastIndexOf("<label");
  if (lastLabel < 0) return null;
  const labelSection = before.slice(lastLabel);
  const tagEnd = labelSection.indexOf(">");
  const closeTag = labelSection.indexOf("</label>");
  if (tagEnd < 0 || closeTag < 0 || closeTag <= tagEnd) return null;
  const text = labelSection.slice(tagEnd + 1, closeTag).replace(/<[^>]+>/g, "").trim();
  return text || null;
}

const PERSONAL_NAME_TOKENS = new Set([
  "name", "email", "phone", "tel", "telephone", "mobile", "address",
  "city", "state", "province", "zip", "postal", "country", "username",
  "login", "fullname", "firstname", "lastname", "company", "organization",
]);

const CONTROL_TYPES_SKIP = new Set(["hidden", "submit", "button", "image", "reset"]);

const SENSITIVE_TYPES = new Set(["password"]);

const PERSONAL_CONTROL_TYPES = new Set(["text", "email", "tel", "url", "search"]);

export async function auditFormsInteraction(files: CrawledFile[]): Promise<ModuleResult> {
  const issues: AuditIssue[] = [];
  const htmlFiles = files.filter((f) => f.type === "html" && !f.relativePath.startsWith(".well-known"));

  for (const file of htmlFiles) {
    let content = "";
    try { content = fs.readFileSync(file.path, "utf-8"); } catch { continue; }
    const page = file.relativePath;
    const pageIsHttps = /https:\/\//i.test(content);

    const forms = content.match(/<form[\s>][\s\S]*?<\/form>/gi) || [];

    for (const form of forms) {
      const formLower = form.toLowerCase();

      // 4. Nested forms (§4.10.3) — critical
      const innerFormStart = formLower.indexOf("<form", 6);
      if (innerFormStart !== -1) {
        issues.push({
          id: generateId(),
          severity: "critical",
          title: "Nested form detected",
          description: `A <form> on "${page}" contains another <form> element, which is not allowed by the HTML spec (§4.10.3).`,
          filePath: page,
          suggestion: "Remove the nested <form>. Use separate forms or group controls with <fieldset>.",
        });
      }

      // 1. Form action attribute (§4.10.3)
      const actionVal = attr(form, "action");
      const missingAction = actionVal === null;

      if (missingAction) {
        issues.push({
          id: generateId(),
          severity: "high",
          title: "Form missing action attribute",
          description: `A <form> on "${page}" has no action attribute — it defaults to the current URL.`,
          filePath: page,
          suggestion: "Set action='https://example.com/submit' to a valid server endpoint.",
        });
      } else {
        const trimmed = actionVal.trim();
        if (trimmed === "" || trimmed === "#" || trimmed.startsWith("javascript:")) {
          issues.push({
            id: generateId(),
            severity: "high",
            title: "Form action points to placeholder",
            description: `A <form> on "${page}" has action="${actionVal}", which does not submit data to a server.`,
            filePath: page,
            suggestion: "Replace the placeholder action with a real endpoint URL.",
          });
        }

        // Mixed content: HTTP action on HTTPS page
        if (pageIsHttps && /^http:\/\//i.test(trimmed)) {
          issues.push({
            id: generateId(),
            severity: "high",
            title: "Form action uses HTTP on HTTPS page",
            description: `A <form> on "${page}" submits to "${actionVal}" over HTTP while the page is served over HTTPS.`,
            filePath: page,
            suggestion: "Change the action URL to HTTPS to prevent mixed-content warnings (OWASP A02).",
          });
        }

        // External domain action
        if (/^https?:\/\//i.test(trimmed)) {
          issues.push({
            id: generateId(),
            severity: "medium",
            title: "Form action points to external domain",
            description: `A <form> on "${page}" submits to an absolute URL: "${actionVal}". Verify this is intentional.`,
            filePath: page,
            suggestion: "Confirm the external endpoint is trusted. Use a relative URL for same-origin endpoints.",
          });
        }
      }

      // 2. Form method attribute (§4.10.3)
      const methodVal = attr(form, "method");
      const formMethod = methodVal ? methodVal.toUpperCase() : null;

      const hasPasswordField = /type\s*=\s*["']password["']/i.test(form);

      if (!formMethod) {
        issues.push({
          id: generateId(),
          severity: "medium",
          title: "Form missing method attribute",
          description: `A <form> on "${page}" has no method attribute — defaults to GET.${hasPasswordField ? " This form contains password fields." : ""}`,
          filePath: page,
          suggestion: "Add method='POST' for forms that send data, or method='GET' for search forms.",
        });
      }

      if (formMethod === "GET" && hasPasswordField) {
        issues.push({
          id: generateId(),
          severity: "high",
          title: "Form uses GET method with password field",
          description: `A <form> on "${page}" uses method="GET" while containing a password field.`,
          filePath: page,
          suggestion: "Change to method='POST' to prevent sensitive data from appearing in URLs and server logs.",
        });
      }

      // 3. Submit button (§4.10.4) — high if missing
      const hasSubmit = /<(?:input|button)[^>]*type\s*=\s*["']submit["']|<input[^>]*type\s*=\s*["']image["']|<button(?!\s+type\s*=)[^>]*>[\s\S]*?<\/button>/i.test(form);
      if (!hasSubmit) {
        issues.push({
          id: generateId(),
          severity: "high",
          title: "Form missing submit button",
          description: `A <form> on "${page}" has no submit button — users cannot submit the form.`,
          filePath: page,
          suggestion: "Add <input type='submit' value='Submit'> or <button type='submit'>Submit</button>.",
        });
      }

      // Extract form controls and labels
      const controls = form.match(/<(?:input|select|textarea)[\s>][\s\S]*?(?:\/?>|<\/(?:input|select|textarea)>)/gi) || [];
      const labelEls = form.match(/<label[\s>][\s\S]*?<\/label>/gi) || [];
      const labelForIds = new Set(
        labelEls
          .map((l) => attr(l, "for")?.toLowerCase())
          .filter((x): x is string => x !== null)
      );

      // Track radio/checkbox groups for fieldset check
      const groupCount = new Map<string, number>();

      // Form-level error identification check
      let formHasErrorSignals = false;
      const formControlTag = form.match(/<(?:input|select|textarea)[\s>]/gi);
      const formHasValidationInputs = formControlTag && formControlTag.length > 0;

      for (const control of controls) {
        const controlType = (attr(control, "type") || "text").toLowerCase();
        const controlId = attr(control, "id")?.toLowerCase() || null;
        const controlName = attr(control, "name") || "";
        const tagName = control.match(/<([a-zA-Z]+)/)?.[1]?.toLowerCase() || "input";

        if (CONTROL_TYPES_SKIP.has(controlType)) continue;

        // 5. SC 3.3.2 — Label association (high if missing, medium if placeholder-only)
        const hasForLabel = controlId ? labelForIds.has(controlId) : false;
        const hasAriaLabel = attr(control, "aria-label") !== null;
        const hasAriaLabelledby = attr(control, "aria-labelledby") !== null;
        const wrappedInLabel = isNestedInLabel(control, labelEls);

        if (!hasForLabel && !hasAriaLabel && !hasAriaLabelledby && !wrappedInLabel) {
          const hasPlaceholder = attr(control, "placeholder") !== null;
          issues.push({
            id: generateId(),
            severity: hasPlaceholder ? "medium" : "high",
            title: hasPlaceholder
              ? "Placeholder used as only label"
              : "Form control missing accessible label",
            description: hasPlaceholder
              ? `A <${tagName}> on "${page}" uses placeholder as the only label, failing WCAG 2.2 SC 3.3.2.`
              : `A <${tagName}> on "${page}" has no associated <label>, aria-label, or aria-labelledby.`,
            filePath: page,
            suggestion: hasPlaceholder
              ? "Add a <label> element with visible text; placeholder disappears on input and fails SC 3.3.2."
              : "Add a <label> element with for='id' or wrap the control, or use aria-label.",
          });
        }

        // 9. SC 2.5.3 — Label in Name (medium)
        const ariaLabelVal = attr(control, "aria-label");
        if (ariaLabelVal) {
          const visibleText = findVisibleLabelText(control, form);
          if (visibleText) {
            const al = ariaLabelVal.toLowerCase();
            const vt = visibleText.toLowerCase();
            if (!vt.includes(al) && !al.includes(vt)) {
              issues.push({
                id: generateId(),
                severity: "medium",
                title: "aria-label does not match visible label text",
                description: `A control on "${page}" has aria-label="${ariaLabelVal}" but visible text nearby is "${visibleText}".`,
                filePath: page,
                suggestion: "Ensure the accessible name contains the visible label text (WCAG 2.2 SC 2.5.3).",
              });
            }
          }
        }

        // 6. SC 1.3.5 — autocomplete attribute (low)
        if (PERSONAL_CONTROL_TYPES.has(controlType)) {
          const nameLower = controlName.toLowerCase();
          const idLower = controlId || "";
          const isPersonal = [...PERSONAL_NAME_TOKENS].some(
            (t) => nameLower.includes(t) || idLower.includes(t)
          );
          if (isPersonal && attr(control, "autocomplete") === null) {
            issues.push({
              id: `invalid-autocomplete-${page}-${attr(control, "name") || attr(control, "id") || controlType}`,
              severity: "low",
              title: "Input missing autocomplete attribute",
              description: `A <${tagName}> on "${page}" collects personal data but lacks autocomplete (SC 1.3.5).`,
              filePath: page,
              suggestion: "Add autocomplete='name', 'email', 'tel', etc. to enable browser autofill.",
            });
          }
        }

        // 7. SC 3.3.1 — Error identification signals
        if (["text", "email", "tel", "url", "password", "search", "number"].includes(controlType)) {
          const hasRequired = attr(control, "required") !== null;
          const hasPattern = attr(control, "pattern") !== null;
          const hasAriaDescribedby = attr(control, "aria-describedby") !== null;
          const hasAriaInvalid = attr(control, "aria-invalid") !== null;
          if (hasRequired || hasPattern || hasAriaDescribedby || hasAriaInvalid) {
            formHasErrorSignals = true;
          }
        }

        // 12. Password fields
        if (tagName === "input" && controlType === "password") {
          const auto = attr(control, "autocomplete");
          if (auto && auto.toLowerCase() === "off") {
            issues.push({
              id: generateId(),
              severity: "low",
              title: "Password field has autocomplete='off'",
              description: `A password field on "${page}" uses autocomplete="off", which may interfere with password managers.`,
              filePath: page,
              suggestion: "Use autocomplete='current-password' or 'new-password' instead of 'off'.",
            });
          }
        }

        // Password field should use type="password"
        if (tagName === "input" && controlType !== "password") {
          const nameLower = controlName.toLowerCase();
          const idLower = controlId || "";
          if (nameLower.includes("password") || nameLower.includes("pwd") || idLower.includes("password") || idLower.includes("pwd")) {
            issues.push({
              id: generateId(),
              severity: "high",
              title: "Password field missing type='password'",
              description: `An input on "${page}" is named "${controlName}" but does not use type="password".`,
              filePath: page,
              suggestion: "Add type='password' to mask the input and prevent visual eavesdropping.",
            });
          }
        }

        // Track radio/checkbox groups
        if (controlType === "radio" || controlType === "checkbox") {
          if (controlName) {
            groupCount.set(controlName, (groupCount.get(controlName) || 0) + 1);
          }
        }

        // 13. File input accept attribute (low)
        if (controlType === "file" && attr(control, "accept") === null) {
          issues.push({
            id: generateId(),
            severity: "low",
            title: "File input missing accept attribute",
            description: `A file input on "${page}" has no accept attribute to restrict file types.`,
            filePath: page,
            suggestion: "Add accept='.pdf,.doc,.jpg' or a MIME type to guide file selection.",
          });
        }
      }

      // 7 (form-level). SC 3.3.1 — No error signals on form
      if (formHasValidationInputs && !formHasErrorSignals) {
        issues.push({
          id: generateId(),
          severity: "low",
          title: "Form lacks error identification attributes",
          description: `A <form> on "${page}" has input fields but no required, pattern, aria-describedby, or aria-invalid attributes.`,
          filePath: page,
          suggestion: "Add required/pattern for validation and aria-describedby/aria-invalid for error identification (SC 3.3.1).",
        });
      }

      // 8. SC 3.3.2 — fieldset/legend for grouped radio buttons / checkboxes (medium)
      const hasFieldset = /<fieldset[\s>][\s\S]*?<\/fieldset>/i.test(form);
      const hasLegend = /<legend[\s>][\s\S]*?<\/legend>/i.test(form);
      for (const [name, count] of groupCount) {
        if (count > 1 && (!hasFieldset || !hasLegend)) {
          issues.push({
            id: generateId(),
            severity: "medium",
            title: "Radio or checkbox group missing <fieldset> or <legend>",
            description: `Controls named "${name}" on "${page}" form a group but lack <fieldset> and <legend> (SC 3.3.2).`,
            filePath: page,
            suggestion: "Wrap the group in <fieldset> and add a <legend> describing the group purpose.",
          });
          break; // one issue per form is enough
        }
      }
    }

    // 11. Mailto link validation
    const mailtoLinks = content.match(/href\s*=\s*["']mailto:[^"']*["']/gi) || [];
    for (const link of mailtoLinks) {
      const addr = attr(link, "href")?.replace(/^mailto:/i, "") || "";
      const trimmedAddr = addr.trim();

      if (!trimmedAddr) {
        issues.push({
          id: generateId(),
          severity: "medium",
          title: "Empty mailto link",
          description: `Found an empty mailto: link on "${page}".`,
          filePath: page,
          suggestion: "Provide a valid email address or use a contact form instead.",
        });
      } else if (/[\s"]/.test(trimmedAddr) || /spam|remove|nospam|remove/i.test(trimmedAddr)) {
        issues.push({
          id: generateId(),
          severity: "medium",
          title: "Obfuscated or suspicious mailto link",
          description: `Found suspicious mailto:${trimmedAddr} on "${page}".`,
          filePath: page,
          suggestion: "Use a contact form instead of obfuscated email addresses.",
        });
      } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(trimmedAddr)) {
        issues.push({
          id: generateId(),
          severity: "medium",
          title: "Invalid email in mailto link",
          description: `Mailto link on "${page}" has an invalid email address: "${trimmedAddr}".`,
          filePath: page,
          suggestion: "Correct the email address format in the mailto: link.",
        });
      }
    }
  }

  const score = calculateModuleScore(issues);
  const status: ModuleResult["status"] = score >= 80 ? "pass" : score >= 50 ? "warning" : "fail";

  return {
    moduleId: "16-forms-interaction",
    moduleName: "Forms & Interaction",
    status,
    score,
    issues,
    summary: `${issues.length} form interaction issue${issues.length !== 1 ? "s" : ""} found across ${htmlFiles.length} page${htmlFiles.length !== 1 ? "s" : ""}`,
  };
}
