# @barqel/barq-email

Transactional email for [Barq](https://github.com/Barqel/barq), powered by
[nodemailer](https://nodemailer.com).

One object sends the mail: it owns the defaults, renders the templates,
retries the failures and hands back one result that says what happened.

```bash
bun add @barqel/barq-email
```

## Use it

```ts
import { emailPlugin, mailer } from "@barqel/barq-email";

app.plugin(emailPlugin({ from: "hello@example.com" }));

await mailer().send({
  to: "user@example.com",
  template: {
    subject: "Welcome {{ name }}",
    html: "<p>Hello {{ name }}, welcome aboard.</p>",
  },
  data: { name: "Hassan" },
});
```

Inside a Barq application the plugin is wired by the kernel, so the mailer
is already there:

```ts
// app/services/mail.ts
import { injectable, mailer } from "@barq";

@injectable()
export class MailService {
  async sendWelcome(email: string, name: string): Promise<void> {
    await mailer().send({
      to: email,
      template: { subject: "Welcome {{ name }}", html: "<p>Hi {{ name }}</p>" },
      data: { name },
    });
  }
}
```

## Transports

| Transport | What it does |
| --- | --- |
| `smtp` | A real SMTP server — the default. |
| `log` | Prints the message in the terminal, sends nothing. |
| `json` | Returns the message as JSON — never touches the network. |
| `stream` | Hands the raw MIME over — the transport used by tests. |
| `sendmail` | Pipes the message into the local sendmail binary. |

```ts
const mailer = new Mailer({
  transport: "smtp",
  host: "smtp.example.com",
  port: 587,
  auth: { user: "postmaster@example.com", pass: "secret" },
  from: "hello@example.com",
});
```

Bring your own transporter when nodemailer is not enough — the plugin stops
building one:

```ts
const mailer = new Mailer({ transporter: myNodemailerTransporter });
```

## Templates

A template is a subject, an HTML body and (optionally) a text body. The
placeholders are filled from the `data` of the message:

```ts
await mailer().send({
  to: "user@example.com",
  template: {
    subject: "Your code is {{ code }}",
    html: "<p>Your code is <strong>{{ code }}</strong>.</p>",
    text: "Your code is {{ code }}.",
  },
  data: { code: "123456" },
});
```

- `{{ name }}` and `{{ user.name }}` are both supported.
- The **values** of an HTML body are escaped, the template markup is not —
  so a user name can never inject HTML into the mail.
- A placeholder without a value renders empty; in strict mode it throws a
  `MailTemplateError`.

## Retries

A failed delivery is retried with a growing delay, then it is given up on
and a `MailDeliveryError` is thrown — carrying the number of attempts and
the original error as its `cause`.

```ts
const mailer = new Mailer({ from: "hello@example.com", retries: 2 });
```

## The result

Every send returns the same object:

```ts
const result = await mailer().send({ to: "user@example.com", subject: "Hi", text: "…" });

result.accepted;   // ["user@example.com"] — the recipients the server took
result.rejected;   // [] — the recipients the server refused
result.messageId;  // "<abc@example.com>"
result.durationMs; // 12
result.transport;  // "smtp"
result.message;    // { from, to, subject, text, html } — what went out
```

## Errors

| Error | When |
| --- | --- |
| `MailConfigurationError` | The mailer is not configured well enough to send. |
| `MailValidationError` | The message is wrong — no recipient, no body. |
| `MailTemplateError` | A template placeholder has no value (strict mode). |
| `MailDeliveryError` | The server refused the message or the connection failed. |

All of them extend `MailError`.

## Scripts

```bash
bun run build       # dist/index.js + dist/*.d.ts
bun run typecheck
bun test
```

MIT
