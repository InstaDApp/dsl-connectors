//SPDX-License-Identifier: MIT
pragma solidity ^0.7.0;

/**
 * @title QuickSwap.
 * @dev Decentralized Exchange.
 */

import { TokenInterface } from "../../common/interfaces.sol";
import { Helpers } from "./helpers.sol";
import { Events } from "./events.sol";

abstract contract QuickpswapResolver is Helpers, Events {
	/**
	 * @dev Deposit Liquidity.
	 * @notice Deposit Liquidity to a QuickSwap pool.
	 * @param tokenA The address of token A.(For ETH: 0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE)
	 * @param tokenB The address of token B.(For ETH: 0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE)
	 * @param amtA The amount of A tokens to deposit.
	 * @param unitAmt The unit amount of of amtB/amtA with slippage.
	 * @param slippage Slippage amount.
	 * @param getId ID to retrieve amtA.
	 * @param setId ID stores the amount of pools tokens received.
	 */
	function deposit(
		address tokenA,
		address tokenB,
		uint256 amtA,
		uint256 unitAmt,
		uint256 slippage,
		uint256 getId,
		uint256 setId
	)
		external
		payable
		returns (string memory _eventName, bytes memory _eventParam)
	{
		uint256 _amt = getUint(getId, amtA);

		(uint256 _amtA, uint256 _amtB, uint256 _uniAmt) = _addLiquidity(
			tokenA,
			tokenB,
			_amt,
			unitAmt,
			slippage
		);
		setUint(setId, _uniAmt);

		_eventName = "LogDepositLiquidity(address,address,uint256,uint256,uint256,uint256,uint256)";
		_eventParam = abi.encode(
			tokenA,
			tokenB,
			_amtA,
			_amtB,
			_uniAmt,
			getId,
			setId
		);
	}

	/**
	 * @dev Withdraw Liquidity.
	 * @notice Withdraw Liquidity from a QuickSwap pool.
	 * @param tokenA The address of token A.(For ETH: 0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE)
	 * @param tokenB The address of token B.(For ETH: 0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE)
	 * @param uniAmt The amount of pool tokens to withdraw.
	 * @param unitAmtA The unit amount of amtA/uniAmt with slippage.
	 * @param unitAmtB The unit amount of amtB/uniAmt with slippage.
	 * @param getId ID to retrieve uniAmt.
	 * @param setIds Array of IDs to store the amount tokens received.
	 */
	function withdraw(
		address tokenA,
		address tokenB,
		uint256 uniAmt,
		uint256 unitAmtA,
		uint256 unitAmtB,
		uint256 getId,
		uint256[] calldata setIds
	)
		external
		payable
		returns (string memory _eventName, bytes memory _eventParam)
	{
		uint256 _amt = getUint(getId, uniAmt);

		(uint256 _amtA, uint256 _amtB, uint256 _uniAmt) = _removeLiquidity(
			tokenA,
			tokenB,
			_amt,
			unitAmtA,
			unitAmtB
		);

		setUint(setIds[0], _amtA);
		setUint(setIds[1], _amtB);

		_eventName = "LogWithdrawLiquidity(address,address,uint256,uint256,uint256,uint256,uint256[])";
		_eventParam = abi.encode(
			tokenA,
			tokenB,
			_amtA,
			_amtB,
			_uniAmt,
			getId,
			setIds
		);
	}

	/**
	 * @dev Buy ETH/ERC20_Token.
	 * @notice Buy a token using a QuickSwap
	 * @param buyAddr The address of the token to buy.(For ETH: 0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE)
	 * @param sellAddr The address of the token to sell.(For ETH: 0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE)
	 * @param buyAmt The amount of tokens to buy.
	 * @param unitAmt The unit amount of sellAmt/buyAmt with slippage.
	 * @param getId ID to retrieve buyAmt.
	 * @param setId ID to store the amount of tokens sold.
	 */
	function buy(
		address buyAddr,
		address sellAddr,
		uint256 buyAmt,
		uint256 unitAmt,
		uint256 getId,
		uint256 setId
	)
		external
		payable
		returns (string memory _eventName, bytes memory _eventParam)
	{
		uint256 _buyAmt = getUint(getId, buyAmt);
		(
			TokenInterface _buyAddr,
			TokenInterface _sellAddr
		) = changeMaticAddress(buyAddr, sellAddr);
		address[] memory paths = getPaths(
			address(_buyAddr),
			address(_sellAddr)
		);

		uint256 _slippageAmt = convert18ToDec(
			_sellAddr.decimals(),
			wmul(unitAmt, convertTo18(_buyAddr.decimals(), _buyAmt))
		);

		checkPair(paths);
		uint256 _expectedAmt = getExpectedSellAmt(paths, _buyAmt);
		require(_slippageAmt >= _expectedAmt, "Too much slippage");

		bool isEth = address(_sellAddr) == wmaticAddr;
		convertMaticToWmatic(isEth, _sellAddr, _expectedAmt);
		approve(_sellAddr, address(router), _expectedAmt);

		uint256 _sellAmt = router.swapTokensForExactTokens(
			_buyAmt,
			_expectedAmt,
			paths,
			address(this),
			block.timestamp + 1
		)[0];

		isEth = address(_buyAddr) == wmaticAddr;
		convertWmaticToMatic(isEth, _buyAddr, _buyAmt);

		setUint(setId, _sellAmt);

		_eventName = "LogBuy(address,address,uint256,uint256,uint256,uint256)";
		_eventParam = abi.encode(
			buyAddr,
			sellAddr,
			_buyAmt,
			_sellAmt,
			getId,
			setId
		);
	}

	/**
	 * @dev Sell ETH/ERC20_Token.
	 * @notice Sell a token using a QuickSwap
	 * @param buyAddr The address of the token to buy.(For ETH: 0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE)
	 * @param sellAddr The address of the token to sell.(For ETH: 0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE)
	 * @param sellAmt The amount of the token to sell.
	 * @param unitAmt The unit amount of buyAmt/sellAmt with slippage.
	 * @param getId ID to retrieve sellAmt.
	 * @param setId ID stores the amount of token brought.
	 */
	function sell(
		address buyAddr,
		address sellAddr,
		uint256 sellAmt,
		uint256 unitAmt,
		uint256 getId,
		uint256 setId
	)
		external
		payable
		returns (string memory _eventName, bytes memory _eventParam)
	{
		uint256 _sellAmt = getUint(getId, sellAmt);
		(
			TokenInterface _buyAddr,
			TokenInterface _sellAddr
		) = changeMaticAddress(buyAddr, sellAddr);
		address[] memory paths = getPaths(
			address(_buyAddr),
			address(_sellAddr)
		);

		if (_sellAmt == uint256(-1)) {
			_sellAmt = sellAddr == maticAddr
				? address(this).balance
				: _sellAddr.balanceOf(address(this));
		}

		uint256 _slippageAmt = convert18ToDec(
			_buyAddr.decimals(),
			wmul(unitAmt, convertTo18(_sellAddr.decimals(), _sellAmt))
		);

		checkPair(paths);
		uint256 _expectedAmt = getExpectedBuyAmt(paths, _sellAmt);
		require(_slippageAmt <= _expectedAmt, "Too much slippage");

		bool isEth = address(_sellAddr) == wmaticAddr;
		convertMaticToWmatic(isEth, _sellAddr, _sellAmt);
		approve(_sellAddr, address(router), _sellAmt);

		uint256 _buyAmt = router.swapExactTokensForTokens(
			_sellAmt,
			_expectedAmt,
			paths,
			address(this),
			block.timestamp + 1
		)[1];

		isEth = address(_buyAddr) == wmaticAddr;
		convertWmaticToMatic(isEth, _buyAddr, _buyAmt);

		setUint(setId, _buyAmt);

		_eventName = "LogSell(address,address,uint256,uint256,uint256,uint256)";
		_eventParam = abi.encode(
			buyAddr,
			sellAddr,
			_buyAmt,
			_sellAmt,
			getId,
			setId
		);
	}
}

contract ConnectV2QuickswapPolygon is QuickpswapResolver {
	string public constant name = "Quickswap-v1.0";
}
