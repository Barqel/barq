// @barqel/barq-email — transactional email for Barq, powered by nodemailer.
//
// One import for the whole surface: the mailer, the transports, the
// template engine, the plugin and the error family.
//
//   import { emailPlugin, mailer } from "@barqel/barq-email";
//
//   app.plugin(emailPlugin({ from: "hello@example.com" }));
//
//   await mailer().send({
//     to: "user@example.com",
//     template: { subject: "Hi {{ name }}", html: "<p>Hello {{ name }}</p>" },
//     data: { name: "Hassan" },
//   });
export * from "./address";
export * from "./errors";
export * from "./mailer";
export * from "./options";
export * from "./plugin";
export * from "./registry";
export * from "./template";
export * from "./transport";
export * from "./types";
