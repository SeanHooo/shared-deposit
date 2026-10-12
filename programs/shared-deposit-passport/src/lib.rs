use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer};

declare_id!("Bw5pP788g5eK117b7oA1dzSMg4N5ZG5vjcHpEKTzzN2o");
pub const YEAR: i64 = 365 * 86400;
pub const TIMEOUT: i64 = 180 * 86400;
pub const RULES: u8 = 1;
pub const ACTIVE: u8 = 0;
pub const RETURNED: u8 = 1;
pub const FROZEN: u8 = 2;
pub const COMPENSATED: u8 = 3;
pub const TIMED_OUT: u8 = 4;

#[program]
pub mod shared_deposit_passport {
    use super::*;

    pub fn initialize_platform(ctx: Context<InitializePlatform>) -> Result<()> {
        require_keys_neq!(
            ctx.accounts.usdc_mint.key(),
            ctx.accounts.usdt_mint.key(),
            ErrorCode::InvalidAsset
        );
        ctx.accounts.platform.set_inner(Platform {
            operator: ctx.accounts.operator.key(),
            usdc_mint: ctx.accounts.usdc_mint.key(),
            usdt_mint: ctx.accounts.usdt_mint.key(),
            bump: ctx.bumps.platform,
        });
        audit(
            0,
            ctx.accounts.platform.key(),
            ctx.accounts.operator.key(),
            ctx.accounts.operator.key(),
            Pubkey::default(),
            0,
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
            1,
            ctx.accounts.passport.key(),
            ctx.accounts.owner.key(),
            ctx.accounts.owner.key(),
            Pubkey::default(),
            0,
        )
    }

    pub fn initialize_spl_account(ctx: Context<InitializeSplAccount>) -> Result<()> {
        let mint = ctx.accounts.mint.key();
        require!(
            mint == ctx.accounts.platform.usdc_mint || mint == ctx.accounts.platform.usdt_mint,
            ErrorCode::InvalidAsset
        );
        ctx.accounts.deposit_account.set_inner(DepositAccount {
            owner: ctx.accounts.owner.key(),
            passport: ctx.accounts.passport.key(),
            mint,
            available: 0,
            locked: 0,
            minimum_reserve: 1_000_000,
            is_sol: false,
            frozen: false,
            bump: ctx.bumps.deposit_account,
        });
        audit(
            2,
            ctx.accounts.deposit_account.key(),
            ctx.accounts.owner.key(),
            ctx.accounts.owner.key(),
            mint,
            0,
        )
    }

    pub fn initialize_sol_account(ctx: Context<InitializeSolAccount>) -> Result<()> {
        ctx.accounts.deposit_account.set_inner(DepositAccount {
            owner: ctx.accounts.owner.key(),
            passport: ctx.accounts.passport.key(),
            mint: Pubkey::default(),
            available: 0,
            locked: 0,
            minimum_reserve: 10_000_000,
            is_sol: true,
            frozen: false,
            bump: ctx.bumps.deposit_account,
        });
        audit(
            2,
            ctx.accounts.deposit_account.key(),
            ctx.accounts.owner.key(),
            ctx.accounts.owner.key(),
            Pubkey::default(),
            0,
        )
    }

    pub fn deposit_spl(ctx: Context<TransferSpl>, amount: u64) -> Result<()> {
        validate_deposit(&ctx.accounts.deposit_account, amount)?;
        require!(
            !ctx.accounts.deposit_account.is_sol,
            ErrorCode::InvalidAsset
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
            3,
            ctx.accounts.deposit_account.key(),
            ctx.accounts.owner.key(),
            ctx.accounts.owner.key(),
            ctx.accounts.deposit_account.mint,
            amount,
        )
    }

    pub fn deposit_sol(ctx: Context<TransferSol>, amount: u64) -> Result<()> {
        validate_deposit(&ctx.accounts.deposit_account, amount)?;
        require!(ctx.accounts.deposit_account.is_sol, ErrorCode::InvalidAsset);
        anchor_lang::system_program::transfer(
            CpiContext::new(
                ctx.accounts.system_program.to_account_info(),
                anchor_lang::system_program::Transfer {
                    from: ctx.accounts.owner.to_account_info(),
                    to: ctx.accounts.deposit_account.to_account_info(),
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
            3,
            ctx.accounts.deposit_account.key(),
            ctx.accounts.owner.key(),
            ctx.accounts.owner.key(),
            Pubkey::default(),
            amount,
        )
    }

    pub fn withdraw_spl(ctx: Context<TransferSpl>, amount: u64) -> Result<()> {
        validate_withdraw(&ctx.accounts.deposit_account, amount)?;
        require!(
            !ctx.accounts.deposit_account.is_sol,
            ErrorCode::InvalidAsset
        );
        let bump = [ctx.accounts.deposit_account.bump];
        let seeds: &[&[u8]] = &[
            b"deposit",
            ctx.accounts.deposit_account.owner.as_ref(),
            ctx.accounts.deposit_account.mint.as_ref(),
            &bump,
        ];
        let signer = [seeds];
        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.vault.to_account_info(),
                    to: ctx.accounts.owner_token.to_account_info(),
                    authority: ctx.accounts.deposit_account.to_account_info(),
                },
                &signer,
            ),
            amount,
        )?;
        ctx.accounts.deposit_account.available -= amount;
        audit(
            4,
            ctx.accounts.deposit_account.key(),
            ctx.accounts.owner.key(),
            ctx.accounts.owner.key(),
            ctx.accounts.deposit_account.mint,
            amount,
        )
    }

    pub fn withdraw_sol(ctx: Context<TransferSol>, amount: u64) -> Result<()> {
        validate_withdraw(&ctx.accounts.deposit_account, amount)?;
        require!(ctx.accounts.deposit_account.is_sol, ErrorCode::InvalidAsset);
        let vault = ctx.accounts.deposit_account.to_account_info();
        require!(
            vault
                .lamports()
                .saturating_sub(Rent::get()?.minimum_balance(vault.data_len()))
                >= amount,
            ErrorCode::InsufficientAvailable
        );
        ctx.accounts.deposit_account.sub_lamports(amount)?;
        ctx.accounts.owner.add_lamports(amount)?;
        ctx.accounts.deposit_account.available -= amount;
        audit(
            4,
            ctx.accounts.deposit_account.key(),
            ctx.accounts.owner.key(),
            ctx.accounts.owner.key(),
            Pubkey::default(),
            amount,
        )
    }

    pub fn register_merchant(ctx: Context<RegisterMerchant>, name: String) -> Result<()> {
        require!(
            !name.trim().is_empty() && name.len() <= 64,
            ErrorCode::InvalidInput
        );
        ctx.accounts.merchant.set_inner(Merchant {
            authority: ctx.accounts.merchant_key.key(),
            operator: ctx.accounts.operator.key(),
            active: true,
            name,
            bump: ctx.bumps.merchant,
        });
        audit(
            5,
            ctx.accounts.merchant.key(),
            ctx.accounts.operator.key(),
            ctx.accounts.operator.key(),
            Pubkey::default(),
            0,
        )
    }

    pub fn set_merchant_active(ctx: Context<SetMerchantActive>, active: bool) -> Result<()> {
        ctx.accounts.merchant.active = active;
        audit(
            6,
            ctx.accounts.merchant.key(),
            ctx.accounts.operator.key(),
            ctx.accounts.operator.key(),
            Pubkey::default(),
            active as u64,
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
        require!(rules_version == RULES, ErrorCode::InvalidRules);
        require!(
            !item_id.trim().is_empty() && item_id.len() <= 64 && due_at > now,
            ErrorCode::InvalidInput
        );
        require!(ctx.accounts.merchant.active, ErrorCode::MerchantInactive);
        require!(
            ctx.accounts.passport.active_lock == Pubkey::default(),
            ErrorCode::ConcurrentLock
        );
        validate_lock_amount(&ctx.accounts.deposit_account, amount)?;
        require!(
            ctx.accounts.passport.next_nonce == nonce,
            ErrorCode::InvalidNonce
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
            7,
            ctx.accounts.authorization.key(),
            ctx.accounts.owner.key(),
            ctx.accounts.owner.key(),
            ctx.accounts.deposit_account.mint,
            amount,
        )
    }

    pub fn revoke_authorization(ctx: Context<RevokeAuthorization>) -> Result<()> {
        require!(
            ctx.accounts.authorization.active && !ctx.accounts.authorization.consumed,
            ErrorCode::AuthorizationUnavailable
        );
        ctx.accounts.authorization.active = false;
        audit(
            8,
            ctx.accounts.authorization.key(),
            ctx.accounts.owner.key(),
            ctx.accounts.owner.key(),
            ctx.accounts.deposit_account.mint,
            ctx.accounts.authorization.amount,
        )
    }

    pub fn lock_deposit(ctx: Context<LockDeposit>) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let auth = &mut ctx.accounts.authorization;
        require!(ctx.accounts.merchant.active, ErrorCode::MerchantInactive);
        require!(
            auth.active && !auth.consumed,
            ErrorCode::AuthorizationUnavailable
        );
        require!(
            auth.expires_at > now && auth.due_at > now,
            ErrorCode::AuthorizationExpired
        );
        require!(auth.rules_version == RULES, ErrorCode::InvalidRules);
        require!(
            ctx.accounts.passport.active_lock == Pubkey::default(),
            ErrorCode::ConcurrentLock
        );
        validate_lock_amount(&ctx.accounts.deposit_account, auth.amount)?;
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
            return_status: 255,
            nonce: auth.nonce,
            returned_at: 0,
            released_at: 0,
            photo_url: String::new(),
            photo_hash: [0; 32],
            rules_version: RULES,
            bump: ctx.bumps.rental_lock,
        });
        ctx.accounts.deposit_account.available -= auth.amount;
        ctx.accounts.deposit_account.locked = auth.amount;
        ctx.accounts.passport.active_lock = ctx.accounts.rental_lock.key();
        auth.consumed = true;
        auth.active = false;
        audit(
            9,
            ctx.accounts.rental_lock.key(),
            auth.owner,
            ctx.accounts.merchant_signer.key(),
            ctx.accounts.deposit_account.mint,
            auth.amount,
        )
    }

    pub fn record_return(
        ctx: Context<UpdateRental>,
        return_status: u8,
        photo_url: String,
        photo_hash: [u8; 32],
    ) -> Result<()> {
        require!(return_status <= 2, ErrorCode::InvalidReturnStatus);
        require!(
            ctx.accounts.rental_lock.status == ACTIVE,
            ErrorCode::InvalidLockState
        );
        require!(
            photo_url.len() <= 256 && (photo_url.is_empty() || photo_url.starts_with("https://")),
            ErrorCode::InvalidPhoto
        );
        let lock = &mut ctx.accounts.rental_lock;
        lock.return_status = return_status;
        lock.returned_at = Clock::get()?.unix_timestamp;
        lock.photo_url = photo_url;
        lock.photo_hash = photo_hash;
        if return_status == 0 {
            release(
                &mut ctx.accounts.deposit_account,
                &mut ctx.accounts.passport,
                lock,
                RETURNED,
            )?;
        } else {
            lock.status = FROZEN;
            ctx.accounts.deposit_account.frozen = true;
        }
        audit(
            if return_status == 0 { 10 } else { 11 },
            lock.key(),
            lock.owner,
            ctx.accounts.merchant_signer.key(),
            ctx.accounts.deposit_account.mint,
            lock.amount,
        )
    }

    pub fn confirm_compensated(ctx: Context<UpdateRental>) -> Result<()> {
        require!(
            ctx.accounts.rental_lock.status == FROZEN,
            ErrorCode::InvalidLockState
        );
        release(
            &mut ctx.accounts.deposit_account,
            &mut ctx.accounts.passport,
            &mut ctx.accounts.rental_lock,
            COMPENSATED,
        )?;
        audit(
            12,
            ctx.accounts.rental_lock.key(),
            ctx.accounts.rental_lock.owner,
            ctx.accounts.merchant_signer.key(),
            ctx.accounts.deposit_account.mint,
            ctx.accounts.rental_lock.amount,
        )
    }

    pub fn keeper_release(ctx: Context<KeeperRelease>) -> Result<()> {
        require!(
            ctx.accounts.rental_lock.status == ACTIVE,
            ErrorCode::InvalidLockState
        );
        require!(
            Clock::get()?.unix_timestamp
                >= ctx
                    .accounts
                    .rental_lock
                    .started_at
                    .checked_add(TIMEOUT)
                    .ok_or(ErrorCode::Overflow)?,
            ErrorCode::TooEarly
        );
        release(
            &mut ctx.accounts.deposit_account,
            &mut ctx.accounts.passport,
            &mut ctx.accounts.rental_lock,
            TIMED_OUT,
        )?;
        audit(
            13,
            ctx.accounts.rental_lock.key(),
            ctx.accounts.rental_lock.owner,
            ctx.accounts.keeper.key(),
            ctx.accounts.deposit_account.mint,
            ctx.accounts.rental_lock.amount,
        )
    }
}

fn audit(
    action: u8,
    subject: Pubkey,
    owner: Pubkey,
    actor: Pubkey,
    mint: Pubkey,
    amount: u64,
) -> Result<()> {
    emit!(PassportEvent {
        action,
        subject,
        owner,
        actor,
        mint,
        amount,
        timestamp: Clock::get()?.unix_timestamp
    });
    Ok(())
}
fn validate_deposit(account: &DepositAccount, amount: u64) -> Result<()> {
    require!(amount > 0, ErrorCode::InvalidAmount);
    require!(
        account.locked == 0 && !account.frozen,
        ErrorCode::AccountUnavailable
    );
    Ok(())
}
fn validate_withdraw(account: &DepositAccount, amount: u64) -> Result<()> {
    validate_deposit(account, amount)?;
    require!(
        amount <= account.available,
        ErrorCode::InsufficientAvailable
    );
    Ok(())
}
fn validate_lock_amount(account: &DepositAccount, amount: u64) -> Result<()> {
    validate_deposit(account, amount)?;
    require!(
        account.available
            >= amount
                .checked_add(account.minimum_reserve)
                .ok_or(ErrorCode::Overflow)?,
        ErrorCode::MinimumBalance
    );
    Ok(())
}
fn release(
    deposit: &mut Account<DepositAccount>,
    passport: &mut Account<DepositPassport>,
    lock: &mut Account<RentalLock>,
    status: u8,
) -> Result<()> {
    require_keys_eq!(
        passport.active_lock,
        lock.key(),
        ErrorCode::InvalidLockState
    );
    require!(deposit.locked == lock.amount, ErrorCode::InvalidLockState);
    deposit.available = deposit
        .available
        .checked_add(lock.amount)
        .ok_or(ErrorCode::Overflow)?;
    deposit.locked = 0;
    deposit.frozen = false;
    passport.active_lock = Pubkey::default();
    lock.status = status;
    lock.released_at = Clock::get()?.unix_timestamp;
    Ok(())
}

#[derive(Accounts)]
pub struct InitializePlatform<'info> {
    #[account(mut)]
    pub operator: Signer<'info>,
    #[account(constraint = program.programdata_address()? == Some(program_data.key()) @ ErrorCode::InvalidAuthority)]
    pub program: Program<'info, crate::program::SharedDepositPassport>,
    #[account(constraint = program_data.upgrade_authority_address == Some(operator.key()) @ ErrorCode::InvalidAuthority)]
    pub program_data: Account<'info, ProgramData>,
    #[account(constraint = usdc_mint.decimals == 6 @ ErrorCode::InvalidAsset)]
    pub usdc_mint: Account<'info, Mint>,
    #[account(constraint = usdt_mint.decimals == 6 @ ErrorCode::InvalidAsset)]
    pub usdt_mint: Account<'info, Mint>,
    #[account(init, payer = operator, space = 8 + Platform::INIT_SPACE, seeds = [b"platform"], bump)]
    pub platform: Account<'info, Platform>,
    pub system_program: Program<'info, System>,
}
#[derive(Accounts)]
pub struct InitializePassport<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(init, payer = owner, space = 8 + DepositPassport::INIT_SPACE, seeds = [b"passport", owner.key().as_ref()], bump)]
    pub passport: Account<'info, DepositPassport>,
    pub system_program: Program<'info, System>,
}
#[derive(Accounts)]
pub struct InitializeSplAccount<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(seeds = [b"passport", owner.key().as_ref()], bump = passport.bump, has_one = owner)]
    pub passport: Account<'info, DepositPassport>,
    #[account(seeds = [b"platform"], bump = platform.bump)]
    pub platform: Account<'info, Platform>,
    #[account(constraint = mint.decimals == 6 @ ErrorCode::InvalidAsset)]
    pub mint: Account<'info, Mint>,
    #[account(init, payer = owner, space = 8 + DepositAccount::INIT_SPACE, seeds = [b"deposit", owner.key().as_ref(), mint.key().as_ref()], bump)]
    pub deposit_account: Account<'info, DepositAccount>,
    #[account(init_if_needed, payer = owner, associated_token::mint = mint, associated_token::authority = deposit_account)]
    pub vault: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}
#[derive(Accounts)]
pub struct InitializeSolAccount<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(seeds = [b"passport", owner.key().as_ref()], bump = passport.bump, has_one = owner)]
    pub passport: Account<'info, DepositPassport>,
    #[account(seeds = [b"platform"], bump = platform.bump)]
    pub platform: Account<'info, Platform>,
    #[account(init, payer = owner, space = 8 + DepositAccount::INIT_SPACE, seeds = [b"deposit", owner.key().as_ref(), Pubkey::default().as_ref()], bump)]
    pub deposit_account: Account<'info, DepositAccount>,
    pub system_program: Program<'info, System>,
}
#[derive(Accounts)]
pub struct TransferSpl<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(seeds = [b"passport", owner.key().as_ref()], bump = passport.bump, has_one = owner)]
    pub passport: Account<'info, DepositPassport>,
    #[account(mut, seeds = [b"deposit", owner.key().as_ref(), deposit_account.mint.as_ref()], bump = deposit_account.bump, has_one = owner, has_one = passport)]
    pub deposit_account: Account<'info, DepositAccount>,
    #[account(mut, token::authority = owner, token::mint = deposit_account.mint)]
    pub owner_token: Account<'info, TokenAccount>,
    #[account(mut, associated_token::mint = deposit_account.mint, associated_token::authority = deposit_account)]
    pub vault: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}
#[derive(Accounts)]
pub struct TransferSol<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(seeds = [b"passport", owner.key().as_ref()], bump = passport.bump, has_one = owner)]
    pub passport: Account<'info, DepositPassport>,
    #[account(mut, seeds = [b"deposit", owner.key().as_ref(), Pubkey::default().as_ref()], bump = deposit_account.bump, has_one = owner, has_one = passport)]
    pub deposit_account: Account<'info, DepositAccount>,
    pub system_program: Program<'info, System>,
}
#[derive(Accounts)]
pub struct RegisterMerchant<'info> {
    #[account(mut)]
    pub operator: Signer<'info>,
    #[account(seeds = [b"platform"], bump = platform.bump, has_one = operator)]
    pub platform: Account<'info, Platform>,
    /// CHECK: Only an identity key; registration does not grant access to funds.
    pub merchant_key: UncheckedAccount<'info>,
    #[account(init, payer = operator, space = 8 + Merchant::INIT_SPACE, seeds = [b"merchant", merchant_key.key().as_ref()], bump)]
    pub merchant: Account<'info, Merchant>,
    pub system_program: Program<'info, System>,
}
#[derive(Accounts)]
pub struct SetMerchantActive<'info> {
    pub operator: Signer<'info>,
    #[account(seeds = [b"platform"], bump = platform.bump, has_one = operator)]
    pub platform: Account<'info, Platform>,
    #[account(mut, seeds = [b"merchant", merchant.authority.as_ref()], bump = merchant.bump, has_one = operator)]
    pub merchant: Account<'info, Merchant>,
}
#[derive(Accounts)]
#[instruction(amount: u64, item_id: String, due_at: i64, nonce: u64)]
pub struct AuthorizeRental<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(mut, seeds = [b"passport", owner.key().as_ref()], bump = passport.bump, has_one = owner)]
    pub passport: Account<'info, DepositPassport>,
    #[account(seeds = [b"merchant", merchant.authority.as_ref()], bump = merchant.bump)]
    pub merchant: Account<'info, Merchant>,
    #[account(seeds = [b"deposit", owner.key().as_ref(), deposit_account.mint.as_ref()], bump = deposit_account.bump, has_one = owner, has_one = passport)]
    pub deposit_account: Account<'info, DepositAccount>,
    #[account(init, payer = owner, space = 8 + MerchantAuthorization::INIT_SPACE, seeds = [b"auth", passport.key().as_ref(), nonce.to_le_bytes().as_ref()], bump)]
    pub authorization: Account<'info, MerchantAuthorization>,
    pub system_program: Program<'info, System>,
}
#[derive(Accounts)]
pub struct RevokeAuthorization<'info> {
    pub owner: Signer<'info>,
    #[account(seeds = [b"passport", owner.key().as_ref()], bump = passport.bump, has_one = owner)]
    pub passport: Account<'info, DepositPassport>,
    #[account(seeds = [b"deposit", owner.key().as_ref(), deposit_account.mint.as_ref()], bump = deposit_account.bump, has_one = owner, has_one = passport)]
    pub deposit_account: Account<'info, DepositAccount>,
    #[account(mut, seeds = [b"auth", passport.key().as_ref(), authorization.nonce.to_le_bytes().as_ref()], bump = authorization.bump, has_one = owner, has_one = passport, has_one = deposit_account)]
    pub authorization: Account<'info, MerchantAuthorization>,
}
#[derive(Accounts)]
pub struct LockDeposit<'info> {
    #[account(mut)]
    pub merchant_signer: Signer<'info>,
    #[account(mut, seeds = [b"passport", passport.owner.as_ref()], bump = passport.bump)]
    pub passport: Account<'info, DepositPassport>,
    #[account(seeds = [b"merchant", merchant_signer.key().as_ref()], bump = merchant.bump, constraint = merchant.authority == merchant_signer.key())]
    pub merchant: Account<'info, Merchant>,
    #[account(mut, seeds = [b"deposit", passport.owner.as_ref(), deposit_account.mint.as_ref()], bump = deposit_account.bump, has_one = passport)]
    pub deposit_account: Account<'info, DepositAccount>,
    #[account(mut, seeds = [b"auth", passport.key().as_ref(), authorization.nonce.to_le_bytes().as_ref()], bump = authorization.bump, has_one = passport, has_one = merchant, has_one = deposit_account, constraint = authorization.owner == passport.owner)]
    pub authorization: Account<'info, MerchantAuthorization>,
    #[account(init, payer = merchant_signer, space = 8 + RentalLock::INIT_SPACE, seeds = [b"lock", passport.key().as_ref(), authorization.nonce.to_le_bytes().as_ref()], bump)]
    pub rental_lock: Account<'info, RentalLock>,
    pub system_program: Program<'info, System>,
}
#[derive(Accounts)]
pub struct UpdateRental<'info> {
    pub merchant_signer: Signer<'info>,
    #[account(mut, seeds = [b"passport", passport.owner.as_ref()], bump = passport.bump)]
    pub passport: Account<'info, DepositPassport>,
    #[account(mut, seeds = [b"deposit", passport.owner.as_ref(), deposit_account.mint.as_ref()], bump = deposit_account.bump, has_one = passport)]
    pub deposit_account: Account<'info, DepositAccount>,
    #[account(seeds = [b"merchant", merchant_signer.key().as_ref()], bump = merchant.bump, constraint = merchant.authority == merchant_signer.key())]
    pub merchant: Account<'info, Merchant>,
    #[account(mut, seeds = [b"lock", passport.key().as_ref(), rental_lock.nonce.to_le_bytes().as_ref()], bump = rental_lock.bump, has_one = passport, has_one = merchant, has_one = deposit_account, constraint = rental_lock.owner == passport.owner)]
    pub rental_lock: Account<'info, RentalLock>,
}
#[derive(Accounts)]
pub struct KeeperRelease<'info> {
    pub keeper: Signer<'info>,
    #[account(mut, seeds = [b"passport", passport.owner.as_ref()], bump = passport.bump)]
    pub passport: Account<'info, DepositPassport>,
    #[account(mut, seeds = [b"deposit", passport.owner.as_ref(), deposit_account.mint.as_ref()], bump = deposit_account.bump, has_one = passport)]
    pub deposit_account: Account<'info, DepositAccount>,
    #[account(mut, seeds = [b"lock", passport.key().as_ref(), rental_lock.nonce.to_le_bytes().as_ref()], bump = rental_lock.bump, has_one = passport, has_one = deposit_account, constraint = rental_lock.owner == passport.owner)]
    pub rental_lock: Account<'info, RentalLock>,
}

#[account]
#[derive(InitSpace)]
pub struct Platform {
    pub operator: Pubkey,
    pub usdc_mint: Pubkey,
    pub usdt_mint: Pubkey,
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
    pub minimum_reserve: u64,
    pub is_sol: bool,
    pub frozen: bool,
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
    pub return_status: u8,
    pub nonce: u64,
    pub returned_at: i64,
    pub released_at: i64,
    #[max_len(256)]
    pub photo_url: String,
    pub photo_hash: [u8; 32],
    pub rules_version: u8,
    pub bump: u8,
}
#[event]
pub struct PassportEvent {
    pub action: u8,
    pub subject: Pubkey,
    pub owner: Pubkey,
    pub actor: Pubkey,
    pub mint: Pubkey,
    pub amount: u64,
    pub timestamp: i64,
}
#[error_code]
pub enum ErrorCode {
    #[msg("Invalid or unregistered asset")]
    InvalidAsset,
    #[msg("Amount must be positive")]
    InvalidAmount,
    #[msg("Arithmetic overflow")]
    Overflow,
    #[msg("Insufficient available balance")]
    InsufficientAvailable,
    #[msg("This asset is locked or frozen")]
    AccountUnavailable,
    #[msg("Merchant is inactive")]
    MerchantInactive,
    #[msg("Authorization revoked or already consumed")]
    AuthorizationUnavailable,
    #[msg("Authorization or rental due time expired")]
    AuthorizationExpired,
    #[msg("Another rental is active")]
    ConcurrentLock,
    #[msg("Minimum reserve would be violated")]
    MinimumBalance,
    #[msg("Stale or duplicate nonce")]
    InvalidNonce,
    #[msg("Rental is not in the required state")]
    InvalidLockState,
    #[msg("Invalid return status")]
    InvalidReturnStatus,
    #[msg("180 days have not elapsed")]
    TooEarly,
    #[msg("Invalid input length or due time")]
    InvalidInput,
    #[msg("Photo URL must be HTTPS and at most 256 bytes")]
    InvalidPhoto,
    #[msg("Unsupported rules version")]
    InvalidRules,
    #[msg("Only deployment authority may initialize platform")]
    InvalidAuthority,
}
