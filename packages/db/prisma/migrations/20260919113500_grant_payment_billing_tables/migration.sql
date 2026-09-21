GRANT USAGE ON TYPE public."PaymentWebhookEventStatus" TO fitcrew_app;
GRANT SELECT, INSERT, UPDATE ON public.payment_webhook_event TO fitcrew_app;

GRANT USAGE ON TYPE
  public."BillingInterval",
  public."BillingPlanStatus",
  public."BillingProvider",
  public."BillingSubscriptionStatus",
  public."BillingInvoiceStatus",
  public."OrganizationBillingModel",
  public."BillingFrequency",
  public."OrganizationAllocationModel",
  public."OrganizationAgreementStatus",
  public."OrganizationInvoiceStatus",
  public."OrganizationInvoiceLineBasis",
  public."OrganizationAllocationStatus"
TO fitcrew_app;

GRANT SELECT, INSERT, UPDATE, DELETE ON
  public.billing_plan,
  public.client_billing_subscription,
  public.billing_invoice,
  public.organization_agreement,
  public.organization_invoice,
  public.organization_invoice_line,
  public.organization_coach_allocation
TO fitcrew_app;
