//SPDX-License-Identifier: MIT
pragma solidity ^0.7.0;

interface PrizePoolInterface {
    function token() external view returns (address);
    function depositTo( address to, uint256 amount, address controlledToken, address referrer) external;
    function withdrawInstantlyFrom( address from, uint256 amount, address controlledToken, uint256 maximumExitFee) external returns (uint256);
}

interface TokenFaucetInterface {
    function claim( address user) external returns (uint256);
}

interface TokenFaucetProxyFactoryInterface {
    function claimAll(address user, TokenFaucetInterface[] calldata tokenFaucets) external;
}