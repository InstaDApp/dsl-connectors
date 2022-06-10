// SPDX-License-Identifier: MIT
pragma solidity ^0.7.6;
pragma abicoder v2;

import { TokenInterface } from "../../common/interfaces.sol";

/// @notice Different types of internal tokens
///  - UnderlyingToken: underlying asset for a cToken (except for Ether)
///  - cToken: Compound interest bearing token
///  - cETH: Special handling for cETH tokens
///  - Ether: the one and only
///  - NonMintable: tokens that do not have an underlying (therefore not cTokens)
enum TokenType {
	UnderlyingToken,
	cToken,
	cETH,
	Ether,
	NonMintable
}

/// @notice Specifies different deposit actions that can occur during BalanceAction or BalanceActionWithTrades
enum DepositActionType {
	// No deposit action
	None,
	// Deposit asset cash, depositActionAmount is specified in asset cash external precision
	DepositAsset,
	// Deposit underlying tokens that are mintable to asset cash, depositActionAmount is specified in underlying token
	// external precision
	DepositUnderlying,
	// Deposits specified asset cash external precision amount into an nToken and mints the corresponding amount of
	// nTokens into the account
	DepositAssetAndMintNToken,
	// Deposits specified underlying in external precision, mints asset cash, and uses that asset cash to mint nTokens
	DepositUnderlyingAndMintNToken,
	// Redeems an nToken balance to asset cash. depositActionAmount is specified in nToken precision. Considered a deposit action
	// because it deposits asset cash into an account. If there are fCash residuals that cannot be sold off, will revert.
	RedeemNToken,
	// Converts specified amount of asset cash balance already in Notional to nTokens. depositActionAmount is specified in
	// Notional internal 8 decimal precision.
	ConvertCashToNToken
}

/// @notice Defines a balance action with a set of trades to do as well
struct BalanceActionWithTrades {
	DepositActionType actionType;
	uint16 currencyId;
	uint256 depositActionAmount;
	uint256 withdrawAmountInternalPrecision;
	bool withdrawEntireCashBalance;
	bool redeemToUnderlying;
	// Array of tightly packed 32 byte objects that represent trades. See TradeActionType documentation
	bytes32[] trades;
}

/// @notice Defines a balance action for batchAction
struct BalanceAction {
	// Deposit action to take (if any)
	DepositActionType actionType;
	uint16 currencyId;
	// Deposit action amount must correspond to the depositActionType, see documentation above.
	uint256 depositActionAmount;
	// Withdraw an amount of asset cash specified in Notional internal 8 decimal precision
	uint256 withdrawAmountInternalPrecision;
	// If set to true, will withdraw entire cash balance. Useful if there may be an unknown amount of asset cash
	// residual left from trading.
	bool withdrawEntireCashBalance;
	// If set to true, will redeem asset cash to the underlying token on withdraw.
	bool redeemToUnderlying;
}

struct Token {
	// Address of the token
	address tokenAddress;
	// True if the token has a transfer fee which is used internally to determine
	// the proper balance change
	bool hasTransferFee;
	// Decimal precision of the token as a power of 10
	int256 decimals;
	// Type of token, enumerated above
	TokenType tokenType;
	// Used internally for tokens that have a collateral cap, zero if there is no cap
	uint256 maxCollateralBalance;
}

interface NotionalInterface {
	function getCurrency(uint16 currencyId)
		external
		view
		returns (Token memory assetToken, Token memory underlyingToken);

	function getAccountBalance(uint16 currencyId, address account)
		external
		view
		returns (
			int256 cashBalance,
			int256 nTokenBalance,
			uint256 lastClaimTime
		);

	function depositUnderlyingToken(
		address account,
		uint16 currencyId,
		uint256 amountExternalPrecision
	) external payable returns (uint256);

	function depositAssetToken(
		address account,
		uint16 currencyId,
		uint256 amountExternalPrecision
	) external returns (uint256);

	function withdraw(
		uint16 currencyId,
		uint88 amountInternalPrecision,
		bool redeemToUnderlying
	) external returns (uint256);

	function nTokenClaimIncentives() external returns (uint256);

	function nTokenRedeem(
		address redeemer,
		uint16 currencyId,
		uint96 tokensToRedeem_,
		bool sellTokenAssets,
		bool acceptResidualAssets
	) external returns (int256);

	function batchBalanceAction(
		address account,
		BalanceAction[] calldata actions
	) external payable;

	function batchBalanceAndTradeAction(
		address account,
		BalanceActionWithTrades[] calldata actions
	) external payable;
}

///@dev Aave Interfaces 
// Aave Protocol Data Provider
interface AaveV2DataProviderInterface {
    function getUserReserveData(address _asset, address _user) external view returns (
        uint256 currentATokenBalance,
        uint256 currentStableDebt,
        uint256 currentVariableDebt,
        uint256 principalStableDebt,
        uint256 scaledVariableDebt,
        uint256 stableBorrowRate,
        uint256 liquidityRate,
        uint40 stableRateLastUpdated,
        bool usageAsCollateralEnabled
    );
}

// Aave v2 Helpers
interface AaveV2Interface {
    function deposit(address _asset, uint256 _amount, address _onBehalfOf, uint16 _referralCode) external;
    function withdraw(address _asset, uint256 _amount, address _to) external;
    function borrow(
        address _asset,
        uint256 _amount,
        uint256 _interestRateMode,
        uint16 _referralCode,
        address _onBehalfOf
    ) external;
    function repay(address _asset, uint256 _amount, uint256 _rateMode, address _onBehalfOf) external;
    function setUserUseReserveAsCollateral(address _asset, bool _useAsCollateral) external;
}

interface AaveV2LendingPoolProviderInterface {
    function getLendingPool() external view returns (address);
}