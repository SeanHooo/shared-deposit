use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer};

declare_id!("5rnNqVQG4zy4JUYHWxCEaYsbBEpNu8fHLn9p2MsdrVfx");

pub const YEAR: i64 = 365 * 86_400;
pub const TIMEOUT: i64 = 180 * 86_400;
pub const RULES_VERSION: u8 = 2;
pub const USDC_DECIMALS: u8 = 6;
pub const MAX_PASSPORT_DEPOSIT: u64 = 100_000_000;
pub const MAX_RENTAL_DEPOSIT: u64 = 50_000_000;

pub const ACTIVE: u8 = 0;
pub const RETURNED: u8 = 1;
pub const DISPUTED: u8 = 2;
pub const RELEASED_TO_GUEST: u8 = 3;
pub const PAID_TO_MERCHANT: u8 = 4;
pub const TIMED_OUT: u8 = 5;

pub const RESOLVE_TO_GUEST: u8 = 0;
pub const RESOLVE_TO_MERCHANT: u8 = 1;

#[program]
pub mod shared_deposit_v2 {
    use super::*;

    pub fn initialize_platform(ctx: Context<InitializePlatform>) -> Result<()> {
        ctx.accounts.platform.set_inner(Platform {
            operator: ctx.accounts.operator.key(),
            usdc_mint: ctx.accounts.usdc_mint.key(),
            bump: ctx.bumps.platform,
        });
        audit(
            AuditAction::PlatformInitialized,
            ctx.accounts.platform.key(),
            ctx.accounts.operator.key(),
            ctx.accounts.operator.key(),
            0,
            [0; 32],
        )
    }

    pub fn initialize_passport(ctx: Context<InitializePassport>) -> Result<()> {
        ctx.accounts.passport.set_inner(DepositPassport {
            owner: ctx.accounts.owner.key(),
            active_lock: Pubkey::default(),
            next_nonce: 0,
            bump: ctx.bumps.passport,
        });
        audit(
            AuditAction::PassportInitialized,
            ctx.accounts.passport.key(),
            ctx.accounts.owner.key(),
            ctx.accounts.owner.key(),
            0,
            [0; 32],
        )
    }

    pub fn initialize_deposit(ctx: Context<InitializeDeposit>) -> Result<()> {
        ctx.accounts.deposit_account.set_inner(DepositAccount {
            owner: ctx.accounts.owner.key(),
            passport: ctx.accounts.passport.key(),
            mint: ctx.accounts.platform.usdc_mint,
            available: 0,
            locked: 0,
            bump: ctx.bumps.deposit_account,
        });
        audit(
            AuditAction::DepositInitialized,
            ctx.accounts.deposit_account.key(),
            ctx.accounts.owner.key(),
            ctx.accounts.owner.key(),
            0,
            [0; 32],
        )
    }

    pub fn deposit(ctx: Context<TransferDeposit>, amount: u64) -> Result<()> {
        validate_positive_amount(amount)?;
        validate_deposit_capacity(
            ctx.accounts.deposit_account.available,
            ctx.accounts.deposit_account.locked,
            amount,
        )?;
        require!(
            ctx.accounts.deposit_account.locked == 0,
            ErrorCode::AccountUnavailable
        );
        token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.owner_token.to_account_info(),
                    to: ctx.accounts.vault.to_account_info(),
                    authority: ctx.accounts.owner.to_account_info(),
                },
            ),
            amount,
        )?;
        ctx.accounts.deposit_account.available = ctx
            .accounts
            .deposit_account
            .available
            .checked_add(amount)
            .ok_or(ErrorCode::Overflow)?;
        audit(
            AuditAction::Deposited,
            ctx.accounts.deposit_account.key(),
            ctx.accounts.owner.key(),
            ctx.accounts.owner.key(),
            amount,
            [0; 32],
        )
    }

    pub fn withdraw(ctx: Context<TransferDeposit>, amount: u64) -> Result<()> {
        validate_positive_amount(amount)?;
        require!(
            ctx.accounts.deposit_account.locked == 0,
            ErrorCode::AccountUnavailable
        );
        validate_withdraw_amount(ctx.accounts.deposit_account.available, amount)?;
        let bump = [ctx.accounts.deposit_account.bump];
        let seeds: &[&[u8]] = &[
            b"deposit-v2",
            ctx.accounts.deposit_account.owner.as_ref(),
            ctx.accounts.deposit_account.mint.as_ref(),
            &bump,
        ];
        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.vault.to_account_info(),
                    to: ctx.accounts.owner_token.to_account_info(),
                    authority: ctx.accounts.deposit_account.to_account_info(),
                },
                &[seeds],
            ),
            amount,
        )?;
        ctx.accounts.deposit_account.available = ctx
            .accounts
            .deposit_account
            .available
            .checked_sub(amount)
            .ok_or(ErrorCode::Overflow)?;
        audit(
            AuditAction::Withdrawn,
            ctx.accounts.deposit_account.key(),
            ctx.accounts.owner.key(),
            ctx.accounts.owner.key(),
            amount,
            [0; 32],
        )
    }

    pub fn register_merchant(ctx: Context<RegisterMerchant>, name: String) -> Result<()> {
        validate_merchant_name(&name)?;
        ctx.accounts.merchant.set_inner(Merchant {
            authority: ctx.accounts.merchant_key.key(),
            operator: ctx.accounts.operator.key(),
            active: true,
            name,
            bump: ctx.bumps.merchant,
        });
        audit(
            AuditAction::MerchantRegistered,
            ctx.accounts.merchant.key(),
            ctx.accounts.operator.key(),
            ctx.accounts.operator.key(),
            0,
            [0; 32],
        )
    }

    pub fn set_merchant_active(ctx: Context<SetMerchantActive>, active: bool) -> Result<()> {
        ctx.accounts.merchant.active = active;
        audit(
            AuditAction::MerchantStatusChanged,
            ctx.accounts.merchant.key(),
            ctx.accounts.operator.key(),
            ctx.accounts.operator.key(),
            active as u64,
            [0; 32],
        )
    }

    pub fn authorize_rental(
        ctx: Context<AuthorizeRental>,
        amount: u64,
        item_id: String,
        due_at: i64,
        nonce: u64,
        rules_version: u8,
    ) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        validate_rental_terms(amount, &item_id, due_at, now, rules_version)?;
        require!(ctx.accounts.merchant.active, ErrorCode::MerchantInactive);
        require!(
            ctx.accounts.passport.active_lock == Pubkey::default(),
            ErrorCode::ConcurrentLock
        );
        require!(
            ctx.accounts.passport.next_nonce == nonce,
            ErrorCode::InvalidNonce
        );
        require!(
            ctx.accounts.deposit_account.available >= amount,
            ErrorCode::InsufficientAvailable
        );
        ctx.accounts.authorization.set_inner(MerchantAuthorization {
            owner: ctx.accounts.owner.key(),
            passport: ctx.accounts.passport.key(),
            merchant: ctx.accounts.merchant.key(),
            deposit_account: ctx.accounts.deposit_account.key(),
            amount,
            item_id,
            due_at,
            expires_at: now.checked_add(YEAR).ok_or(ErrorCode::Overflow)?,
            nonce,
            rules_version,
            active: true,
            consumed: false,
            bump: ctx.bumps.authorization,
        });
        ctx.accounts.passport.next_nonce = nonce.checked_add(1).ok_or(ErrorCode::Overflow)?;
        audit(
            AuditAction::RentalAuthorized,
            ctx.accounts.authorization.key(),
            ctx.accounts.owner.key(),
            ctx.accounts.owner.key(),
            amount,
            [0; 32],
        )
    }

    pub fn revoke_authorization(ctx: Context<RevokeAuthorization>) -> Result<()> {
        require!(
            ctx.accounts.authorization.active && !ctx.accounts.authorization.consumed,
            ErrorCode::AuthorizationUnavailable
        );
        ctx.accounts.authorization.active = false;
        audit(
            AuditAction::AuthorizationRevoked,
            ctx.accounts.authorization.key(),
            ctx.accounts.owner.key(),
            ctx.accounts.owner.key(),
            ctx.accounts.authorization.amount,
            [0; 32],
        )
    }

    pub fn lock_deposit(ctx: Context<LockDeposit>) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let auth = &ctx.accounts.authorization;
        require!(ctx.accounts.merchant.active, ErrorCode::MerchantInactive);
        require!(
            auth.active && !auth.consumed,
            ErrorCode::AuthorizationUnavailable
        );
        require!(
            auth.expires_at > now && auth.due_at > now,
            ErrorCode::AuthorizationExpired
        );
        require!(auth.rules_version == RULES_VERSION, ErrorCode::InvalidRules);
        require!(auth.amount <= MAX_RENTAL_DEPOSIT, ErrorCode::RentalLimit);
        require!(
            ctx.accounts.passport.active_lock == Pubkey::default(),
            ErrorCode::ConcurrentLock
        );
        require!(
            ctx.accounts.deposit_account.available >= auth.amount,
            ErrorCode::InsufficientAvailable
        );
        ctx.accounts.rental_lock.set_inner(RentalLock {
            passport: ctx.accounts.passport.key(),
            owner: auth.owner,
            merchant: auth.merchant,
            deposit_account: auth.deposit_account,
            amount: auth.amount,
            started_at: now,
            due_at: auth.due_at,
            item_id: auth.item_id.clone(),
            status: ACTIVE,
            nonce: auth.nonce,
            returned_at: 0,
            disputed_at: 0,
            resolved_at: 0,
            evidence_digest: [0; 32],
            resolution_digest: [0; 32],
            rules_version: RULES_VERSION,
            bump: ctx.bumps.rental_lock,
        });
        ctx.accounts.deposit_account.available = ctx
            .accounts
            .deposit_account
            .available
            .checked_sub(auth.amount)
            .ok_or(ErrorCode::Overflow)?;
        ctx.accounts.deposit_account.locked = auth.amount;
        ctx.accounts.passport.active_lock = ctx.accounts.rental_lock.key();
        let auth = &mut ctx.accounts.authorization;
        auth.consumed = true;
        auth.active = false;
        audit(
            AuditAction::RentalLocked,
            ctx.accounts.rental_lock.key(),
            auth.owner,
            ctx.accounts.merchant_signer.key(),
            auth.amount,
            [0; 32],
        )
    }

    pub fn confirm_return(
        ctx: Context<MerchantRentalUpdate>,
        evidence_digest: [u8; 32],
    ) -> Result<()> {
        require!(
            ctx.accounts.rental_lock.status == ACTIVE,
            ErrorCode::InvalidRentalState
        );
        require!(
            evidence_digest != [0; 32],
            ErrorCode::EvidenceDigestRequired
        );
        let now = Clock::get()?.unix_timestamp;
        ctx.accounts.rental_lock.returned_at = now;
        ctx.accounts.rental_lock.evidence_digest = evidence_digest;
        release_to_guest(
            &mut ctx.accounts.deposit_account,
            &mut ctx.accounts.passport,
            &mut ctx.accounts.rental_lock,
            RETURNED,
            now,
        )?;
        audit(
            AuditAction::RentalReturned,
            ctx.accounts.rental_lock.key(),
            ctx.accounts.rental_lock.owner,
            ctx.accounts.merchant_signer.key(),
            ctx.accounts.rental_lock.amount,
            evidence_digest,
        )
    }

    pub fn open_dispute(
        ctx: Context<MerchantRentalUpdate>,
        evidence_digest: [u8; 32],
    ) -> Result<()> {
        require!(
            ctx.accounts.rental_lock.status == ACTIVE,
            ErrorCode::InvalidRentalState
        );
        require!(
            evidence_digest != [0; 32],
            ErrorCode::EvidenceDigestRequired
        );
        let now = Clock::get()?.unix_timestamp;
        ctx.accounts.rental_lock.status = DISPUTED;
        ctx.accounts.rental_lock.disputed_at = now;
        ctx.accounts.rental_lock.evidence_digest = evidence_digest;
        audit(
            AuditAction::DisputeOpened,
            ctx.accounts.rental_lock.key(),
            ctx.accounts.rental_lock.owner,
            ctx.accounts.merchant_signer.key(),
            ctx.accounts.rental_lock.amount,
            evidence_digest,
        )
    }

    pub fn resolve_dispute(
        ctx: Context<ResolveDispute>,
        outcome: u8,
        resolution_digest: [u8; 32],
    ) -> Result<()> {
        require!(
            resolution_digest != [0; 32],
            ErrorCode::EvidenceDigestRequired
        );
        require!(
            matches!(outcome, RESOLVE_TO_GUEST | RESOLVE_TO_MERCHANT),
            ErrorCode::InvalidOutcome
        );
        require!(
            ctx.accounts.rental_lock.status == DISPUTED,
            ErrorCode::InvalidRentalState
        );
        let now = Clock::get()?.unix_timestamp;
        ctx.accounts.rental_lock.resolution_digest = resolution_digest;
        if outcome == RESOLVE_TO_GUEST {
            release_to_guest(
                &mut ctx.accounts.deposit_account,
                &mut ctx.accounts.passport,
                &mut ctx.accounts.rental_lock,
                RELEASED_TO_GUEST,
                now,
            )?;
        } else {
            let merchant_token = ctx
                .accounts
                .merchant_token
                .as_ref()
                .ok_or(ErrorCode::MerchantTokenRequired)?;
            pay_merchant(
                &mut ctx.accounts.deposit_account,
                &mut ctx.accounts.passport,
                &mut ctx.accounts.rental_lock,
                &ctx.accounts.vault,
                merchant_token,
                &ctx.accounts.token_program,
                now,
            )?;
        }
        audit(
            AuditAction::DisputeResolved,
            ctx.accounts.rental_lock.key(),
            ctx.accounts.rental_lock.owner,
            ctx.accounts.operator.key(),
            outcome as u64,
            resolution_digest,
        )
    }

    pub fn keeper_release(ctx: Context<KeeperRelease>) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        require!(
            can_keeper_release(
                ctx.accounts.rental_lock.status,
                ctx.accounts.rental_lock.started_at,
                now,
            ),
            ErrorCode::TooEarly
        );
        release_to_guest(
            &mut ctx.accounts.deposit_account,
            &mut ctx.accounts.passport,
            &mut ctx.accounts.rental_lock,
            TIMED_OUT,
            now,
        )?;
        audit(
            AuditAction::TimedOut,
            ctx.accounts.rental_lock.key(),
            ctx.accounts.rental_lock.owner,
            ctx.accounts.keeper.key(),
            ctx.accounts.rental_lock.amount,
            [0; 32],
        )
    }
}

fn validate_positive_amount(amount: u64) -> Result<()> {
    require!(amount > 0, ErrorCode::InvalidAmount);
    Ok(())
}

fn validate_deposit_capacity(available: u64, locked: u64, amount: u64) -> Result<()> {
    validate_positive_amount(amount)?;
    let current = available.checked_add(locked).ok_or(ErrorCode::Overflow)?;
    let next = current.checked_add(amount).ok_or(ErrorCode::Overflow)?;
    require!(next <= MAX_PASSPORT_DEPOSIT, ErrorCode::PassportLimit);
    Ok(())
}

fn validate_withdraw_amount(available: u64, amount: u64) -> Result<()> {
    require!(amount <= available, ErrorCode::InsufficientAvailable);
    Ok(())
}

fn validate_merchant_name(name: &str) -> Result<()> {
    require!(
        !name.trim().is_empty() && name.len() <= 64,
        ErrorCode::InvalidInput
    );
    Ok(())
}

fn validate_rental_terms(
    amount: u64,
    item_id: &str,
    due_at: i64,
    now: i64,
    rules_version: u8,
) -> Result<()> {
    validate_positive_amount(amount)?;
    require!(amount <= MAX_RENTAL_DEPOSIT, ErrorCode::RentalLimit);
    require!(
        !item_id.trim().is_empty() && item_id.len() <= 64 && due_at > now,
        ErrorCode::InvalidInput
    );
    require!(rules_version == RULES_VERSION, ErrorCode::InvalidRules);
    Ok(())
}

fn can_keeper_release(status: u8, started_at: i64, now: i64) -> bool {
    matches!(status, ACTIVE | DISPUTED)
        && started_at
            .checked_add(TIMEOUT)
            .is_some_and(|deadline| now >= deadline)
}

fn release_to_guest(
    deposit: &mut Account<DepositAccount>,
    passport: &mut Account<DepositPassport>,
    rental: &mut Account<RentalLock>,
    status: u8,
    now: i64,
) -> Result<()> {
    require_keys_eq!(
        passport.active_lock,
        rental.key(),
        ErrorCode::InvalidRentalState
    );
    require!(
        deposit.locked == rental.amount,
        ErrorCode::InvalidRentalState
    );
    deposit.available = deposit
        .available
        .checked_add(rental.amount)
        .ok_or(ErrorCode::Overflow)?;
    deposit.locked = 0;
    passport.active_lock = Pubkey::default();
    rental.status = status;
    rental.resolved_at = now;
    Ok(())
}

#[allow(clippy::too_many_arguments)]
fn pay_merchant<'info>(
    deposit: &mut Account<'info, DepositAccount>,
    passport: &mut Account<DepositPassport>,
    rental: &mut Account<RentalLock>,
    vault: &Account<'info, TokenAccount>,
    merchant_token: &Account<'info, TokenAccount>,
    token_program: &Program<'info, Token>,
    now: i64,
) -> Result<()> {
    require_keys_eq!(
        passport.active_lock,
        rental.key(),
        ErrorCode::InvalidRentalState
    );
    require!(
        deposit.locked == rental.amount,
        ErrorCode::InvalidRentalState
    );
    let bump = [deposit.bump];
    let seeds: &[&[u8]] = &[
        b"deposit-v2",
        deposit.owner.as_ref(),
        deposit.mint.as_ref(),
        &bump,
    ];
    token::transfer(
        CpiContext::new_with_signer(
            token_program.to_account_info(),
            Transfer {
                from: vault.to_account_info(),
                to: merchant_token.to_account_info(),
                authority: deposit.to_account_info(),
            },
            &[seeds],
        ),
        rental.amount,
    )?;
    deposit.locked = 0;
    passport.active_lock = Pubkey::default();
    rental.status = PAID_TO_MERCHANT;
    rental.resolved_at = now;
    Ok(())
}

fn audit(
    action: AuditAction,
    subject: Pubkey,
    owner: Pubkey,
    actor: Pubkey,
    amount: u64,
    digest: [u8; 32],
) -> Result<()> {
    emit!(PassportEvent {
        action: action as u8,
        subject,
        owner,
        actor,
        amount,
        digest,
        timestamp: Clock::get()?.unix_timestamp,
    });
    Ok(())
}

#[derive(Accounts)]
pub struct InitializePlatform<'info> {
    #[account(mut)]
    pub operator: Signer<'info>,
    #[account(constraint = program.programdata_address()? == Some(program_data.key()) @ ErrorCode::InvalidAuthority)]
    pub program: Program<'info, crate::program::SharedDepositV2>,
    #[account(constraint = program_data.upgrade_authority_address == Some(operator.key()) @ ErrorCode::InvalidAuthority)]
    pub program_data: Account<'info, ProgramData>,
    #[account(constraint = usdc_mint.decimals == USDC_DECIMALS @ ErrorCode::InvalidAsset)]
    pub usdc_mint: Account<'info, Mint>,
    #[account(init, payer = operator, space = 8 + Platform::INIT_SPACE, seeds = [b"v2-platform"], bump)]
    pub platform: Account<'info, Platform>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct InitializePassport<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(init, payer = owner, space = 8 + DepositPassport::INIT_SPACE, seeds = [b"passport-v2", owner.key().as_ref()], bump)]
    pub passport: Account<'info, DepositPassport>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct InitializeDeposit<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(seeds = [b"passport-v2", owner.key().as_ref()], bump = passport.bump, has_one = owner)]
    pub passport: Account<'info, DepositPassport>,
    #[account(seeds = [b"v2-platform"], bump = platform.bump)]
    pub platform: Account<'info, Platform>,
    #[account(address = platform.usdc_mint @ ErrorCode::InvalidAsset)]
    pub usdc_mint: Account<'info, Mint>,
    #[account(init, payer = owner, space = 8 + DepositAccount::INIT_SPACE, seeds = [b"deposit-v2", owner.key().as_ref(), platform.usdc_mint.as_ref()], bump)]
    pub deposit_account: Account<'info, DepositAccount>,
    #[account(init_if_needed, payer = owner, associated_token::mint = usdc_mint, associated_token::authority = deposit_account)]
    pub vault: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct TransferDeposit<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(seeds = [b"passport-v2", owner.key().as_ref()], bump = passport.bump, has_one = owner)]
    pub passport: Account<'info, DepositPassport>,
    #[account(seeds = [b"v2-platform"], bump = platform.bump)]
    pub platform: Account<'info, Platform>,
    #[account(mut, seeds = [b"deposit-v2", owner.key().as_ref(), platform.usdc_mint.as_ref()], bump = deposit_account.bump, has_one = owner, has_one = passport, constraint = deposit_account.mint == platform.usdc_mint @ ErrorCode::InvalidAsset)]
    pub deposit_account: Account<'info, DepositAccount>,
    #[account(mut, token::authority = owner, token::mint = platform.usdc_mint)]
    pub owner_token: Account<'info, TokenAccount>,
    #[account(mut, associated_token::mint = platform.usdc_mint, associated_token::authority = deposit_account)]
    pub vault: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct RegisterMerchant<'info> {
    #[account(mut)]
    pub operator: Signer<'info>,
    #[account(seeds = [b"v2-platform"], bump = platform.bump, has_one = operator)]
    pub platform: Account<'info, Platform>,
    /// CHECK: Identity key only. Merchant registration never grants access to funds.
    pub merchant_key: UncheckedAccount<'info>,
    #[account(init, payer = operator, space = 8 + Merchant::INIT_SPACE, seeds = [b"merchant-v2", merchant_key.key().as_ref()], bump)]
    pub merchant: Account<'info, Merchant>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct SetMerchantActive<'info> {
    pub operator: Signer<'info>,
    #[account(seeds = [b"v2-platform"], bump = platform.bump, has_one = operator)]
    pub platform: Account<'info, Platform>,
    #[account(mut, seeds = [b"merchant-v2", merchant.authority.as_ref()], bump = merchant.bump, has_one = operator)]
    pub merchant: Account<'info, Merchant>,
}

#[derive(Accounts)]
#[instruction(amount: u64, item_id: String, due_at: i64, nonce: u64)]
pub struct AuthorizeRental<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(mut, seeds = [b"passport-v2", owner.key().as_ref()], bump = passport.bump, has_one = owner)]
    pub passport: Account<'info, DepositPassport>,
    #[account(seeds = [b"merchant-v2", merchant.authority.as_ref()], bump = merchant.bump)]
    pub merchant: Account<'info, Merchant>,
    #[account(seeds = [b"v2-platform"], bump = platform.bump)]
    pub platform: Account<'info, Platform>,
    #[account(seeds = [b"deposit-v2", owner.key().as_ref(), platform.usdc_mint.as_ref()], bump = deposit_account.bump, has_one = owner, has_one = passport)]
    pub deposit_account: Account<'info, DepositAccount>,
    #[account(init, payer = owner, space = 8 + MerchantAuthorization::INIT_SPACE, seeds = [b"auth-v2", passport.key().as_ref(), nonce.to_le_bytes().as_ref()], bump)]
    pub authorization: Account<'info, MerchantAuthorization>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct RevokeAuthorization<'info> {
    pub owner: Signer<'info>,
    #[account(seeds = [b"passport-v2", owner.key().as_ref()], bump = passport.bump, has_one = owner)]
    pub passport: Account<'info, DepositPassport>,
    #[account(seeds = [b"deposit-v2", owner.key().as_ref(), deposit_account.mint.as_ref()], bump = deposit_account.bump, has_one = owner, has_one = passport)]
    pub deposit_account: Account<'info, DepositAccount>,
    #[account(mut, seeds = [b"auth-v2", passport.key().as_ref(), authorization.nonce.to_le_bytes().as_ref()], bump = authorization.bump, has_one = owner, has_one = passport, has_one = deposit_account)]
    pub authorization: Account<'info, MerchantAuthorization>,
}

#[derive(Accounts)]
pub struct LockDeposit<'info> {
    #[account(mut)]
    pub merchant_signer: Signer<'info>,
    #[account(mut, seeds = [b"passport-v2", passport.owner.as_ref()], bump = passport.bump)]
    pub passport: Account<'info, DepositPassport>,
    #[account(seeds = [b"merchant-v2", merchant_signer.key().as_ref()], bump = merchant.bump, constraint = merchant.authority == merchant_signer.key())]
    pub merchant: Account<'info, Merchant>,
    #[account(mut, seeds = [b"deposit-v2", passport.owner.as_ref(), deposit_account.mint.as_ref()], bump = deposit_account.bump, has_one = passport)]
    pub deposit_account: Account<'info, DepositAccount>,
    #[account(mut, seeds = [b"auth-v2", passport.key().as_ref(), authorization.nonce.to_le_bytes().as_ref()], bump = authorization.bump, has_one = passport, has_one = merchant, has_one = deposit_account, constraint = authorization.owner == passport.owner)]
    pub authorization: Account<'info, MerchantAuthorization>,
    #[account(init, payer = merchant_signer, space = 8 + RentalLock::INIT_SPACE, seeds = [b"lock-v2", passport.key().as_ref(), authorization.nonce.to_le_bytes().as_ref()], bump)]
    pub rental_lock: Account<'info, RentalLock>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct MerchantRentalUpdate<'info> {
    pub merchant_signer: Signer<'info>,
    #[account(mut, seeds = [b"passport-v2", passport.owner.as_ref()], bump = passport.bump)]
    pub passport: Account<'info, DepositPassport>,
    #[account(mut, seeds = [b"deposit-v2", passport.owner.as_ref(), deposit_account.mint.as_ref()], bump = deposit_account.bump, has_one = passport)]
    pub deposit_account: Account<'info, DepositAccount>,
    #[account(seeds = [b"merchant-v2", merchant_signer.key().as_ref()], bump = merchant.bump, constraint = merchant.authority == merchant_signer.key())]
    pub merchant: Account<'info, Merchant>,
    #[account(mut, seeds = [b"lock-v2", passport.key().as_ref(), rental_lock.nonce.to_le_bytes().as_ref()], bump = rental_lock.bump, has_one = passport, has_one = merchant, has_one = deposit_account, constraint = rental_lock.owner == passport.owner)]
    pub rental_lock: Account<'info, RentalLock>,
}

#[derive(Accounts)]
pub struct ResolveDispute<'info> {
    pub operator: Signer<'info>,
    #[account(seeds = [b"v2-platform"], bump = platform.bump, has_one = operator)]
    pub platform: Account<'info, Platform>,
    #[account(mut, seeds = [b"passport-v2", passport.owner.as_ref()], bump = passport.bump)]
    pub passport: Account<'info, DepositPassport>,
    #[account(mut, seeds = [b"deposit-v2", passport.owner.as_ref(), platform.usdc_mint.as_ref()], bump = deposit_account.bump, has_one = passport, constraint = deposit_account.mint == platform.usdc_mint)]
    pub deposit_account: Account<'info, DepositAccount>,
    #[account(seeds = [b"merchant-v2", merchant.authority.as_ref()], bump = merchant.bump)]
    pub merchant: Account<'info, Merchant>,
    #[account(mut, seeds = [b"lock-v2", passport.key().as_ref(), rental_lock.nonce.to_le_bytes().as_ref()], bump = rental_lock.bump, has_one = passport, has_one = merchant, has_one = deposit_account, constraint = rental_lock.owner == passport.owner)]
    pub rental_lock: Account<'info, RentalLock>,
    #[account(mut, associated_token::mint = platform.usdc_mint, associated_token::authority = deposit_account)]
    pub vault: Account<'info, TokenAccount>,
    #[account(mut, token::mint = platform.usdc_mint, token::authority = merchant.authority)]
    pub merchant_token: Option<Account<'info, TokenAccount>>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct KeeperRelease<'info> {
    pub keeper: Signer<'info>,
    #[account(mut, seeds = [b"passport-v2", passport.owner.as_ref()], bump = passport.bump)]
    pub passport: Account<'info, DepositPassport>,
    #[account(mut, seeds = [b"deposit-v2", passport.owner.as_ref(), deposit_account.mint.as_ref()], bump = deposit_account.bump, has_one = passport)]
    pub deposit_account: Account<'info, DepositAccount>,
    #[account(mut, seeds = [b"lock-v2", passport.key().as_ref(), rental_lock.nonce.to_le_bytes().as_ref()], bump = rental_lock.bump, has_one = passport, has_one = deposit_account, constraint = rental_lock.owner == passport.owner)]
    pub rental_lock: Account<'info, RentalLock>,
}

#[account]
#[derive(InitSpace)]
pub struct Platform {
    pub operator: Pubkey,
    pub usdc_mint: Pubkey,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct DepositPassport {
    pub owner: Pubkey,
    pub active_lock: Pubkey,
    pub next_nonce: u64,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct DepositAccount {
    pub owner: Pubkey,
    pub passport: Pubkey,
    pub mint: Pubkey,
    pub available: u64,
    pub locked: u64,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct Merchant {
    pub authority: Pubkey,
    pub operator: Pubkey,
    pub active: bool,
    #[max_len(64)]
    pub name: String,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct MerchantAuthorization {
    pub owner: Pubkey,
    pub passport: Pubkey,
    pub merchant: Pubkey,
    pub deposit_account: Pubkey,
    pub amount: u64,
    #[max_len(64)]
    pub item_id: String,
    pub due_at: i64,
    pub expires_at: i64,
    pub nonce: u64,
    pub rules_version: u8,
    pub active: bool,
    pub consumed: bool,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct RentalLock {
    pub passport: Pubkey,
    pub owner: Pubkey,
    pub merchant: Pubkey,
    pub deposit_account: Pubkey,
    pub amount: u64,
    pub started_at: i64,
    pub due_at: i64,
    #[max_len(64)]
    pub item_id: String,
    pub status: u8,
    pub nonce: u64,
    pub returned_at: i64,
    pub disputed_at: i64,
    pub resolved_at: i64,
    pub evidence_digest: [u8; 32],
    pub resolution_digest: [u8; 32],
    pub rules_version: u8,
    pub bump: u8,
}

#[event]
pub struct PassportEvent {
    pub action: u8,
    pub subject: Pubkey,
    pub owner: Pubkey,
    pub actor: Pubkey,
    pub amount: u64,
    pub digest: [u8; 32],
    pub timestamp: i64,
}

#[repr(u8)]
pub enum AuditAction {
    PlatformInitialized = 0,
    PassportInitialized = 1,
    DepositInitialized = 2,
    Deposited = 3,
    Withdrawn = 4,
    MerchantRegistered = 5,
    MerchantStatusChanged = 6,
    RentalAuthorized = 7,
    AuthorizationRevoked = 8,
    RentalLocked = 9,
    RentalReturned = 10,
    DisputeOpened = 11,
    DisputeResolved = 12,
    TimedOut = 13,
}

#[error_code]
pub enum ErrorCode {
    #[msg("Only USDC with six decimals is supported")]
    InvalidAsset,
    #[msg("Amount must be positive")]
    InvalidAmount,
    #[msg("Arithmetic overflow")]
    Overflow,
    #[msg("Insufficient available balance")]
    InsufficientAvailable,
    #[msg("This passport is locked")]
    AccountUnavailable,
    #[msg("Merchant is inactive")]
    MerchantInactive,
    #[msg("Authorization revoked or already consumed")]
    AuthorizationUnavailable,
    #[msg("Authorization or rental due time expired")]
    AuthorizationExpired,
    #[msg("Another rental is active")]
    ConcurrentLock,
    #[msg("Stale or duplicate nonce")]
    InvalidNonce,
    #[msg("Rental is not in the required state")]
    InvalidRentalState,
    #[msg("Invalid dispute outcome")]
    InvalidOutcome,
    #[msg("Evidence digest must be non-zero")]
    EvidenceDigestRequired,
    #[msg("180 days have not elapsed")]
    TooEarly,
    #[msg("Invalid input length or due time")]
    InvalidInput,
    #[msg("Unsupported rules version")]
    InvalidRules,
    #[msg("Single rental exceeds the 50 USDC cap")]
    RentalLimit,
    #[msg("Passport balance would exceed the 100 USDC cap")]
    PassportLimit,
    #[msg("Only deployment authority may initialize platform")]
    InvalidAuthority,
    #[msg("Merchant token account is required for a merchant payout")]
    MerchantTokenRequired,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn deposit_cap_is_enforced_without_overflow() {
        assert!(validate_deposit_capacity(0, 0, MAX_PASSPORT_DEPOSIT).is_ok());
        assert!(validate_deposit_capacity(90_000_000, 0, 10_000_001).is_err());
        assert!(validate_deposit_capacity(50_000_000, 50_000_000, 1).is_err());
        assert!(validate_deposit_capacity(u64::MAX, 1, 1).is_err());
    }

    #[test]
    fn rental_cap_is_enforced_at_the_program_boundary() {
        let now = 1_000;
        assert!(
            validate_rental_terms(MAX_RENTAL_DEPOSIT, "tent-42", now + 1, now, RULES_VERSION)
                .is_ok()
        );
        assert!(validate_rental_terms(
            MAX_RENTAL_DEPOSIT + 1,
            "tent-42",
            now + 1,
            now,
            RULES_VERSION
        )
        .is_err());
    }

    #[test]
    fn only_disputed_rentals_can_time_out_for_keeper_release() {
        let started = 1_000;
        let after_timeout = started + TIMEOUT;
        assert!(can_keeper_release(ACTIVE, started, after_timeout));
        assert!(can_keeper_release(DISPUTED, started, after_timeout));
        assert!(!can_keeper_release(RETURNED, started, after_timeout));
        assert!(!can_keeper_release(
            PAID_TO_MERCHANT,
            started,
            after_timeout
        ));
        assert!(!can_keeper_release(ACTIVE, started, after_timeout - 1));
        assert!(!can_keeper_release(ACTIVE, i64::MAX, i64::MAX));
    }

    #[test]
    fn full_deposit_can_fund_the_rental_cap() {
        assert!(validate_deposit_capacity(0, 0, MAX_RENTAL_DEPOSIT).is_ok());
        assert!(validate_rental_terms(
            MAX_RENTAL_DEPOSIT,
            "road-bike",
            2_000,
            1_000,
            RULES_VERSION
        )
        .is_ok());
    }
}
